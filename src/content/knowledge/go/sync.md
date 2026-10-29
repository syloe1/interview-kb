# Once.go

```go
type Once struct {
	_ noCopy
	done atomic.Bool
	m    Mutex
}

func (o *Once) Do(f func()) {
	if !o.done.Load() {
		o.doSlow(f)
	}
}

func (o *Once) doSlow(f func()) {
	o.m.Lock()
	defer o.m.Unlock()
	if !o.done.Load() {
		defer o.done.Store(true)
		f()
	}
}

```

# pool.go

```go

type Pool struct {
	noCopy noCopy
	local     unsafe.Pointer
	localSize uintptr
	victim    unsafe.Pointer
	victimSize uintptr
	New func() any
}

type poolLocalInternal struct {
	private any
	shared  poolChain
}

type poolLocal struct {
	poolLocalInternal
	pad [128 - unsafe.Sizeof(poolLocalInternal{})%128]byte
}

//go:linkname runtime_randn runtime.randn
func runtime_randn(n uint32) uint32

var poolRaceHash [128]uint64

func poolRaceAddr(x any) unsafe.Pointer {
	ptr := uintptr((*[2]unsafe.Pointer)(unsafe.Pointer(&x))[1])
	h := uint32((uint64(uint32(ptr)) * 0x85ebca6b) >> 16)
	return unsafe.Pointer(&poolRaceHash[h%uint32(len(poolRaceHash))])
}

func (p *Pool) Put(x any) {
	if x == nil {
		return
	}
	if race.Enabled {
		if runtime_randn(4) == 0 {
			return
		}
		race.ReleaseMerge(poolRaceAddr(x))
		race.Disable()
	}
    // pin() G绑定p, 禁止抢占
	l, _ := p.pin()
	if l.private == nil {
		l.private = x
	} else {
		l.shared.pushHead(x)
	}
	runtime_procUnpin()
	if race.Enabled {
		race.Enable()
	}
}

func (p *Pool) Get() any {
	if race.Enabled {
		race.Disable()
	}
	l, pid := p.pin()
	x := l.private
	l.private = nil
	if x == nil {
		x, _ = l.shared.popHead()
		if x == nil {
			x = p.getSlow(pid)
		}
	}
	runtime_procUnpin()
	if race.Enabled {
		race.Enable()
		if x != nil {
			race.Acquire(poolRaceAddr(x))
		}
	}
	if x == nil && p.New != nil {
		x = p.New()
	}
	return x
}

func (p *Pool) getSlow(pid int) any {
	size := rtatomic.LoadAcquintptr(&p.localSize)
	locals := p.local
	for i := 0; i < int(size); i++ {
		l := indexLocal(locals, (pid+i+1)%int(size))
		if x, _ := l.shared.popTail(); x != nil {
			return x
		}
	}
	size = atomic.LoadUintptr(&p.victimSize)
	if uintptr(pid) >= size {
		return nil
	}
	locals = p.victim
	l := indexLocal(locals, pid)
	if x := l.private; x != nil {
		l.private = nil
		return x
	}
	for i := 0; i < int(size); i++ {
		l := indexLocal(locals, (pid+i)%int(size))
		if x, _ := l.shared.popTail(); x != nil {
			return x
		}
	}
	atomic.StoreUintptr(&p.victimSize, 0)
	return nil
}

func (p *Pool) pin() (*poolLocal, int) {
	if p == nil {
		panic("nil Pool")
	}
	pid := runtime_procPin()
	s := rtatomic.LoadAcquintptr(&p.localSize)
	l := p.local
	if uintptr(pid) < s {
		return indexLocal(l, pid), pid
	}
	return p.pinSlow()
}

func (p *Pool) pinSlow() (*poolLocal, int) {
	runtime_procUnpin()
	allPoolsMu.Lock()
	defer allPoolsMu.Unlock()
	pid := runtime_procPin()
	s := p.localSize
	l := p.local
	if uintptr(pid) < s {
		return indexLocal(l, pid), pid
	}
	if p.local == nil {
		allPools = append(allPools, p)
	}
	size := runtime.GOMAXPROCS(0)
	local := make([]poolLocal, size)
	atomic.StorePointer(&p.local, unsafe.Pointer(&local[0]))
	rtatomic.StoreReluintptr(&p.localSize, uintptr(size))
	return &local[pid], pid
}

//go:linkname poolCleanup
func poolCleanup() {
	for _, p := range oldPools {
		p.victim = nil
		p.victimSize = 0
	}
	for _, p := range allPools {
		p.victim = p.local
		p.victimSize = p.localSize
		p.local = nil
		p.localSize = 0
	}
	oldPools, allPools = allPools, nil
}

var (
	allPoolsMu Mutex
	allPools []*Pool
	oldPools []*Pool
)

func init() {
	runtime_registerPoolCleanup(poolCleanup)
}

func indexLocal(l unsafe.Pointer, i int) *poolLocal {
	lp := unsafe.Pointer(uintptr(l) + uintptr(i)*unsafe.Sizeof(poolLocal{}))
	return (*poolLocal)(lp)
}

func runtime_registerPoolCleanup(cleanup func())
func runtime_procPin() int
func runtime_procUnpin()

```

# Mutex.go

```go
type Mutex struct {
	_ noCopy
	mu isync.Mutex
}

type Locker interface {
	Lock()
	Unlock()
}

func (m *Mutex) Lock() {
	m.mu.Lock()
}

func (m *Mutex) TryLock() bool {
	return m.mu.TryLock()
}

func (m *Mutex) Unlock() {
	m.mu.Unlock()
}
// 下面是isync.Mutex
type Mutex struct {
	state int32
	sema  uint32
}

const (
	mutexLocked = 1 << iota
	mutexWoken
	mutexStarving
	mutexWaiterShift = iota
	starvationThresholdNs = 1e6
)

func (m *Mutex) Lock() {
	if atomic.CompareAndSwapInt32(&m.state, 0, mutexLocked) {
		if race.Enabled {
			race.Acquire(unsafe.Pointer(m))
		}
		return
	}
	m.lockSlow()
}

func (m *Mutex) TryLock() bool {
	old := m.state
	if old&(mutexLocked|mutexStarving) != 0 {
		return false
	}
	if !atomic.CompareAndSwapInt32(&m.state, old, old|mutexLocked) {
		return false
	}
	if race.Enabled {
		race.Acquire(unsafe.Pointer(m))
	}
	return true
}

func (m *Mutex) lockSlow() {
	var waitStartTime int64
	starving := false
	awoke := false
	iter := 0
	old := m.state
	for {
		if old&(mutexLocked|mutexStarving) == mutexLocked && runtime_canSpin(iter) {
			if !awoke && old&mutexWoken == 0 && old>>mutexWaiterShift != 0 &&
				atomic.CompareAndSwapInt32(&m.state, old, old|mutexWoken) {
				awoke = true
			}
			runtime_doSpin()
			iter++
			old = m.state
			continue
		}
		new := old
		if old&mutexStarving == 0 {
			new |= mutexLocked
		}
		if old&(mutexLocked|mutexStarving) != 0 {
			new += 1 << mutexWaiterShift
		}
		if starving && old&mutexLocked != 0 {
			new |= mutexStarving
		}
		if awoke {
			if new&mutexWoken == 0 {
				throw("sync: inconsistent mutex state")
			}
			new &^= mutexWoken
		}
		if atomic.CompareAndSwapInt32(&m.state, old, new) {
			if old&(mutexLocked|mutexStarving) == 0 {
				break
			}
			queueLifo := waitStartTime != 0
			if waitStartTime == 0 {
				waitStartTime = runtime_nanotime()
			}
			runtime_SemacquireMutex(&m.sema, queueLifo, 2)
			starving = starving || runtime_nanotime()-waitStartTime > starvationThresholdNs
			old = m.state
			if old&mutexStarving != 0 {
				if old&(mutexLocked|mutexWoken) != 0 || old>>mutexWaiterShift == 0 {
					throw("sync: inconsistent mutex state")
				}
				delta := int32(mutexLocked - 1<<mutexWaiterShift)
				if !starving || old>>mutexWaiterShift == 1 {
					delta -= mutexStarving
				}
				atomic.AddInt32(&m.state, delta)
				break
			}
			awoke = true
			iter = 0
		} else {
			old = m.state
		}
	}
	if race.Enabled {
		race.Acquire(unsafe.Pointer(m))
	}
}

func (m *Mutex) Unlock() {
	if race.Enabled {
		_ = m.state
		race.Release(unsafe.Pointer(m))
	}
	new := atomic.AddInt32(&m.state, -mutexLocked)
	if new != 0 {
		m.unlockSlow(new)
	}
}

func (m *Mutex) unlockSlow(new int32) {
	if (new+mutexLocked)&mutexLocked == 0 {
		fatal("sync: unlock of unlocked mutex")
	}
	if new&mutexStarving == 0 {
		old := new
		for {
			if old>>mutexWaiterShift == 0 || old&(mutexLocked|mutexWoken|mutexStarving) != 0 {
				return
			}
			new = (old - 1<<mutexWaiterShift) | mutexWoken
			if atomic.CompareAndSwapInt32(&m.state, old, new) {
				runtime_Semrelease(&m.sema, false, 2)
				return
			}
			old = m.state
		}
	} else {
		runtime_Semrelease(&m.sema, true, 2)
	}
}

```

# waitgroup.go

> v := int32(state >> 32) // counter任务数
> w := uint32(state & 0x7fffffff) // waiter等待goroutine数量

```go

type WaitGroup struct {
	noCopy noCopy
	state atomic.Uint64
	sema  uint32
}

const waitGroupBubbleFlag = 0x8000_0000

func (wg *WaitGroup) Add(delta int) {
	if race.Enabled {
		if delta < 0 {
			race.ReleaseMerge(unsafe.Pointer(wg))
		}
		race.Disable()
		defer race.Enable()
	}
	bubbled := false
	if synctest.IsInBubble() {
		switch synctest.Associate(wg) {
		case synctest.Unbubbled:
		case synctest.OtherBubble:
			fatal("sync: WaitGroup.Add called from multiple synctest bubbles")
		case synctest.CurrentBubble:
			bubbled = true
			state := wg.state.Or(waitGroupBubbleFlag)
			if state != 0 && state&waitGroupBubbleFlag == 0 {
				fatal("sync: WaitGroup.Add called from inside and outside synctest bubble")
			}
		}
	}
	state := wg.state.Add(uint64(delta) << 32)
	if state&waitGroupBubbleFlag != 0 && !bubbled {
		fatal("sync: WaitGroup.Add called from inside and outside synctest bubble")
	}
	v := int32(state >> 32)
	w := uint32(state & 0x7fffffff)
	if race.Enabled && delta > 0 && v == int32(delta) {
		race.Read(unsafe.Pointer(&wg.sema))
	}
	if v < 0 {
		panic("sync: negative WaitGroup counter")
	}
	if w != 0 && delta > 0 && v == int32(delta) {
		panic("sync: WaitGroup misuse: Add called concurrently with Wait")
	}
	if v > 0 || w == 0 {
		return
	}
	if wg.state.Load() != state {
		panic("sync: WaitGroup misuse: Add called concurrently with Wait")
	}
	wg.state.Store(0)
	if bubbled {
		synctest.Disassociate(wg)
	}
	for ; w != 0; w-- {
		runtime_Semrelease(&wg.sema, false, 0)
	}
}

func (wg *WaitGroup) Done() {
	wg.Add(-1)
}


func (wg *WaitGroup) Wait() {
	if race.Enabled {
		race.Disable()
	}
	for {
		state := wg.state.Load()
		v := int32(state >> 32)
		w := uint32(state & 0x7fffffff)
		if v == 0 {
			if race.Enabled {
				race.Enable()
				race.Acquire(unsafe.Pointer(wg))
			}
			if w == 0 && state&waitGroupBubbleFlag != 0 && synctest.IsAssociated(wg) {
				if wg.state.CompareAndSwap(state, 0) {
					synctest.Disassociate(wg)
				}
			}
			return
		}
		if wg.state.CompareAndSwap(state, state+1) {
			if race.Enabled && w == 0 {
				race.Write(unsafe.Pointer(&wg.sema))
			}
			synctestDurable := false
			if state&waitGroupBubbleFlag != 0 && synctest.IsInBubble() {
				if race.Enabled {
					race.Enable()
				}
				if synctest.IsAssociated(wg) {
					synctestDurable = true
				}
				if race.Enabled {
					race.Disable()
				}
			}
			runtime_SemacquireWaitGroup(&wg.sema, synctestDurable)
			isReset := wg.state.Load() != 0
			if race.Enabled {
				race.Enable()
				race.Acquire(unsafe.Pointer(wg))
			}
			if isReset {
				panic("sync: WaitGroup is reused before previous Wait has returned")
			}
			return
		}
	}
}
func (wg *WaitGroup) Go(f func()) {
	wg.Add(1)
	go func() {
		defer func() {
			if x := recover(); x != nil {
				panic(x)
			}
			wg.Done()
		}()
		f()
	}()
}
```
