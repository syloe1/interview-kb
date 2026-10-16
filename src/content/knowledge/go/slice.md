> go version go1.27.0 windows/amd64

### Slice 底层是一个连续内存空间，

| 函数                 | 核心功能                             | 关键特性                                                                  | 内存类型               | 拷贝范围                      | 特殊要点                                                      |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------------- | ---------------------- | ----------------------------- | ------------------------------------------------------------- |
| makeslice            | 分配堆内存，创建切片                 | 长度 / 容量校验；调用 mallocgc 分配；返回 slice 结构体                    | 堆内存                 | -                             | 基础切片创建入口；会校验 len、cap 溢出；支持指针 / 非指针元素 |
| makeslice64          | 64 位版本 makeslice                  | 处理超大长度输入，转成平台 int 后校验；再交给 makeslice                   | 堆内存                 | -                             | 用于接收 int64 的 len/cap 参数                                |
| growslice            | 标准切片扩容                         | nextslicecap 算新容量；堆上分配新内存；拷贝旧元素；GC 写屏障              | 堆内存                 | [0, oldLen)，仅有效元素       | 常规扩容；小切片 <256 cap 翻倍，>=256 每次约 +25%；堆分配     |
| growsliceBuf         | 栈缓冲版本扩容                       | 优先复用栈上 buffer；放不下降级走 growslice；cap 不倍增，roundupsize 对齐 | 优先栈内存，放不下则堆 | [0, oldLen)，仅有效元素       | buf 必须在栈帧内；不能逃逸；多余空间 memclr；不释放旧内存     |
| growsliceBufNoAlias  | growsliceBuf + 手动释放旧内存        | 栈 buffer 扩容；开启 RuntimeFreegc 实验特性时 freegc 释放旧堆内存         | 优先栈内存，放不下则堆 | [0, oldLen)，仅有效元素       | NoAlias：新旧内存无别名；freegc 为实验特性，默认关闭          |
| moveSlice            | 搬迁切片底层数组，保留原 cap         | 完整复制 cap 大小的内存；带 GC 类型元数据；bulk 批量写屏障                | 堆内存                 | [0, cap)（含 len 后空闲空位） | 支持带指针元素；mallocgc 自动清零；栈逃逸搬迁场景             |
| moveSliceNoScan      | moveSlice 的 noscan 变体，保留原 cap | 保留原 cap；noscan 内存，GC 不扫描；无写屏障                              | 堆内存（noscan）       | [0, cap)（含 len 后空闲空位） | 仅无指针值类型；no-zero 分配，内存脏                          |
| moveSliceNoCap       | 搬迁切片，不保留旧 cap               | 不保留旧 cap；只拷贝有效 len 元素；支持指针；bulk 写屏障                  | 堆内存                 | [0, len)，仅有效元素          | cap 由分配器 size class 决定；mallocgc 自动清零               |
| moveSliceNoCapNoScan | NoCap + NoScan 组合版搬迁            | 抛弃旧 cap；noscan；只拷贝 len 元素；多余分配空间手动 memclr              | 堆内存（noscan）       | [0, len)，仅有效元素          | 仅无指针类型；no-zero 分配，多出内存必须手动清零              |
| slicecopy            | 切片元素拷贝                         | 取 min(srcLen, dstLen)；拷贝对应数量元素；区分是否需要 GC 写屏障          | 源 / 目标可堆 / 栈     | n = min(srcLen, dstLen)       | 实现内置 copy()；区分 noscan 与带指针元素                     |
| bytealg_MakeNoZero   | 快速创建 []byte，不清零              | noscan no-zero 分配；roundupsize 对齐；返回切片                           | 堆内存（noscan）       | -                             | 仅 []byte；分配脏内存，调用方必须立刻覆盖                     |
| bytealg_Make         | 创建清零的 []byte                    | mallocgc 带 needZero=true，内存全部置 0                                   | 堆内存（noscan）       | -                             | 普通 make([]byte) 底层                                        |

```go
type slice struct {
    array unsafe.Pointer
    len int
    cap int
}
// unsafe.Pointer 类似c的void *， 是万能指针
type notInHeapSlice struct {
    array *notInHeap // 底层数组在 非GC管理内存上
    len int
    cap int
}
```

#### make([]T, len, cap) 参数非法时， 抛出对应的panic

```go
func panicmakeslicelen() {
    panic(errorString("makeslice: len out of range"))
}
func panicmakeslicecap() {
    panic(errorString("makeslice: cap out of range"))
}
```

## 分配新切片底层数组 + 拷贝元素，copy(dst, src)函数底层调用

> append扩容， 走growslice

```go
// - `et *_type`：元素类型元信息（元素大小、是否包含指针等）
// - `tolen`：目标最多拷贝多少个元素（dst 切片 len）
// - `fromlen`：源切片的长度（src 切片 len）
// - `from unsafe.Pointer`：源切片底层数组指针
// 返回值：新分配好的**底层数组指针**
func makeslicecopy(et *_type, tolen int, fromlen int, from unsafe.Pointer) unsafe.Pointer {
    // tomem = 新分配内存大小 tolen * 元素大小
    // copymem = 实际拷贝的字节 = fromlen * 元素大小
    var tomem, copymem uintptr
    if uintptr(tolen) > uintptr(fromlen) {
        var overflow bool
        tomem, overflow = math.MulUintptr(et.Size_, uintptr(tolen))
        if overflow || tomem > maxAlloc || tolen < 0 {
            panicmakeslicelen()
        }
        copymem = et.Size_ * uintptr(fromlen)
    } else {
        // fromlen >= tolen, 最多拷贝tolen个
        tomem = et.Size_ * uintptr(tolen)
        copymem = tomem
    }

    var to unsafe.Pointer
    if !et.Pointers() {
        // 元素不带指针， int, byte, float64纯值类型
        to  = mallocgc(tomem,nil, false)
//         `mallocgc` 就是 Go 堆上分配内存的底层函数。
// 参数：

// 1. `tomem`：分配多少字节
// 2. `nil`：**没有类型元数据**，GC 不用扫描这块内存
// 3. `false`：noscan 内存，GC 不会进来扫描这块内存里面找指针
        // dst 内存 > src
        if copymem < tomem {
            //- `add(to, copymem)`：跳到目标内存里**拷贝结束的位置**
            //- `memclrNoHeapPointers`：把后面剩下的内存区域全部清零
            memclrNoHeapPointers(add(to, copymem), tomem-copymem)
        }
    } else {
        // gc要知道里面指针的布局
        to = mallocgc(tomem, et, true)
        // writeBarrier 写屏障
        if copymem > 0 && writeBarrier.enabled {
            //`bulkBarrierPreWriteSrcOnly`：批量写屏障，**只扫描源内存里的指针**
            bulkBarrierPreWriteSrcOnly(uintptr(to), uintptr(from), copymem, et)
        }
    }
    //go race 竞态检测器。标记：我正在读取 from 这块内存，用来检测有没有并发读写冲突。`go run -race`才会启用
    if raceenabled {
		callerpc := sys.GetCallerPC()
		pc := abi.FuncPCABIInternal(makeslicecopy)
		racereadrangepc(from, copymem, callerpc, pc)
	}
    //内存污染检测工具，捕获野指针、未初始化内存访问，C/C++ 体系的内存检查工具，Go 可以集成开启。
	if msanenabled {
		msanread(from, copymem)
	}
	if asanenabled {
		asanread(from, copymem)
	}

	memmove(to, from, copymem)

	return to
}
```

#### make， 只分配切片底层数组内存， 不拷贝任何数据

```go
func makeslice(et *_type, len, cap int) unsafe.Pointer {
    mem, overflow := math.MulUintptr(et.Size_, uintptr(cap))
    if overflow || mem > maxAlloc || len < 0 || len > cap {
        // 只要满足任意一条，进panic分支
        // 1. 内存乘法溢出
        // 2. 申请内存超过Go堆单次最大上限maxAlloc
        // 3. len负数
        // 4. len > cap（非法，切片长度不能大于容量）
        mem, overflow  := math.MulUintptr(et.Size_, uintptr(len))
        if overflow || mem > maxAlloc || len < 0 {
            panicmakeslicelen()
        }
        panicmakeslicecap()
    }
    // 调用mallocgc 在 GC堆上分配mem字节内存
    return mallocgc(mem, et, true)
}
```

#### 64位make调用

```go
func makeslice64(et *_type, len64, cap64 int64) unsafe.Pointer {
    len := int(len64)
    // 把int64强转给当前系统的int,
    // 在转换成int64, 如果不相等就说明数字超出当前平台int能承载范围
    if int64(len) != len64 {
        panicmakeslicelen()
    }
    cap := int(cap64)
    if int64(cap) != cap64 {
        panicmakeslicecap()
    }
    return makeslice(et, len, cap)
}
```

## growslice： append切片容量不足时，扩容的总入口函数

> 算出新容量， 分配一块更大的底层数组，拷贝旧数据到新内存

```go
func growslice(oldPtr unsafe.Pointer, newLen, oldCap, num int, et *_type) slice {
    //race /msan/asan 内存检测
	oldLen := newLen - num // 原来切片的长度
	if raceenabled {
		callerpc := sys.GetCallerPC()
		racereadrangepc(oldPtr, uintptr(oldLen*int(et.Size_)), callerpc, abi.FuncPCABIInternal(growslice))
	}
	if msanenabled {
		msanread(oldPtr, uintptr(oldLen*int(et.Size_)))
	}
	if asanenabled {
		asanread(oldPtr, uintptr(oldLen*int(et.Size_)))
	}

	if newLen < 0 {
		panic(errorString("growslice: len out of range"))
	}
    // 空结构体切片， 所有元素共享同一个全局地址
	if et.Size_ == 0 {
		return slice{unsafe.Pointer(&zerobase), newLen, newLen}
	}
    // oldCap < 256, 翻倍
    // oldCap >= 256, new = oldCap + oldCap /4
    // 1.25倍增长
	newcap := nextslicecap(newLen, oldCap)

	var overflow bool
	var lenmem, newlenmem, capmem uintptr
	noscan := !et.Pointers()
	switch {
	case et.Size_ == 1:
		lenmem = uintptr(oldLen)
		newlenmem = uintptr(newLen)
		capmem = roundupsize(uintptr(newcap), noscan)
		overflow = uintptr(newcap) > maxAlloc
		newcap = int(capmem)
	case et.Size_ == goarch.PtrSize: //等于机器指针宽度
		lenmem = uintptr(oldLen) * goarch.PtrSize
		newlenmem = uintptr(newLen) * goarch.PtrSize
		capmem = roundupsize(uintptr(newcap)*goarch.PtrSize, noscan)
		overflow = uintptr(newcap) > maxAlloc/goarch.PtrSize
		newcap = int(capmem / goarch.PtrSize)
	case isPowerOfTwo(et.Size_): //元素大小是2的幂
		var shift uintptr
		if goarch.PtrSize == 8 {
			shift = uintptr(sys.TrailingZeros64(uint64(et.Size_))) & 63
		} else {
			shift = uintptr(sys.TrailingZeros32(uint32(et.Size_))) & 31
		}
		lenmem = uintptr(oldLen) << shift
		newlenmem = uintptr(newLen) << shift
		capmem = roundupsize(uintptr(newcap)<<shift, noscan)
		overflow = uintptr(newcap) > (maxAlloc >> shift)
		newcap = int(capmem >> shift)
		capmem = uintptr(newcap) << shift
	default:
		lenmem = uintptr(oldLen) * et.Size_
		newlenmem = uintptr(newLen) * et.Size_
		capmem, overflow = math.MulUintptr(et.Size_, uintptr(newcap))
		capmem = roundupsize(capmem, noscan)
		newcap = int(capmem / et.Size_)
		capmem = uintptr(newcap) * et.Size_
	}
    // 内存溢出， 申请内存超过Go最大堆上限，panic
	if overflow || capmem > maxAlloc {
		panic(errorString("growslice: len out of range"))
	}
    //分配新内存
	var p unsafe.Pointer
	if !et.Pointers() {
		p = mallocgc(capmem, nil, false)
		memclrNoHeapPointers(add(p, newlenmem), capmem-newlenmem)
	} else {
		p = mallocgc(capmem, et, true)
		if lenmem > 0 && writeBarrier.enabled {
			bulkBarrierPreWriteSrcOnly(uintptr(p), uintptr(oldPtr), lenmem-et.Size_+et.PtrBytes, et)
		}
	}
    // 把oldPtr的lenmem字节，拷贝到新分配内存P
	memmove(p, oldPtr, lenmem)

	return slice{p, newLen, newcap}
}
```

## growsliceNoAlias是growslice的包装器

> 先调用原版 growslice完成切片扩容， 开启实验特性RuntimeFreegc的前提下，尝试主动释放旧底层数组的堆内存

```go
func growsliceNoAlias(oldPtr unsafe.Pointer, newLen, oldCap, num int, et *_type) slice {
	s := growslice(oldPtr, newLen, oldCap, num, et)
    // oldPtr != s.array 扩容之后，新，旧数组地址不一样
	if goexperiment.RuntimeFreegc && oldPtr != nil && oldPtr != s.array {
        // getg() 拿到当前的 goroutine
        //gp.stack.lo 当前 goroutine 栈的起始地址， gp.stack.hi 结束地址
		if gp := getg(); uintptr(oldPtr) < gp.stack.lo || gp.stack.hi <= uintptr(oldPtr) {
			noscan := !et.Pointers()
            // freegc只能释放堆上分配的内存
            // 值类型， noscan为true, 告诉 freegc：这块内存**不存在任何指针，GC 不需要扫描这块内存**
			freegc(oldPtr, uintptr(oldCap)*et.Size_, noscan)
		}
	}
	return s
}
```

## nextslicecap 计算切片扩容时预估的新容量

```go

// nextslicecap computes the next appropriate slice length.
func nextslicecap(newLen, oldCap int) int {
	newcap := oldCap
	doublecap := newcap + newcap
    // 如果需要的新长度newLen > 2 * oldCap 新容量直接 = newLen
	if newLen > doublecap {
		return newLen
	}
	const threshold = 256
    // 小于256 直接翻倍
	if oldCap < threshold {
		return doublecap
	}
    // 扩容1.25倍
	for {
		newcap += (newcap + 3*threshold) >> 2
		if uint(newcap) >= uint(newLen) {
			break
		}
	}
	if newcap <= 0 {
		return newLen
	}
	return newcap
}

```

## reflect_growslice是给reflect包的扩容函数

```go
func reflect_growslice(et *_type, old slice, num int) slice {
// 	`old.cap - old.len`：旧切片里面**已经预留好的空位**（cap-len）。
// `num` 是用户这次**总共想要增加的空位数量**。
// 减去已经有的空位，得到**真正还需要扩容新增的元素个数**传给 growslice
    num -= old.cap - old.len
	new := growslice(old.array, old.cap+num, old.cap, num, et)
	if !et.Pointers() {
        //`oldcapmem`：旧切片容量占用的总字节。
		oldcapmem := uintptr(old.cap) * et.Size_
        //这里的 `new.len` 是 `growslice` 返回的临时 len，等于 `old.cap + num`。
		newlenmem := uintptr(new.len) * et.Size_
		memclrNoHeapPointers(add(new.array, oldcapmem), newlenmem-oldcapmem)
	}
	new.len = old.len // preserve the old length
	return new
}
// 判断是不是2的幂
func isPowerOfTwo(x uintptr) bool {
	return x&(x-1) == 0
}
```

## slicecopy专门给copy() 内置函数使用的拷贝函数

> src, dst元素没有指针，
> src可以是切片或者string

```go
// - `toPtr unsafe.Pointer`：目标切片底层数组起始地址（dst）
// - `toLen int`：目标切片可用长度 len (dst)
// - `fromPtr unsafe.Pointer`：源切片 / 字符串底层数组起始地址（src）
// - `fromLen int`：源的长度 len (src)
// - `width uintptr`：单个元素占用字节大小 `et.Size_`
// slicecopy is used to copy from a string or slice of pointerless elements into a slice.
func slicecopy(toPtr unsafe.Pointer, toLen int, fromPtr unsafe.Pointer, fromLen int, width uintptr) int {
	if fromLen == 0 || toLen == 0 {
		return 0
	}

	n := fromLen
    // 拷贝 n = (src长度， dst可用长度)
	if toLen < n {
		n = toLen
	}

	if width == 0 {
		return n
	}

	size := uintptr(n) * width
    //race /msan/asan 内存检测
	if raceenabled {
		callerpc := sys.GetCallerPC()
		pc := abi.FuncPCABIInternal(slicecopy)
		racereadrangepc(fromPtr, size, callerpc, pc)
		racewriterangepc(toPtr, size, callerpc, pc)
	}
	if msanenabled {
		msanread(fromPtr, size)
		msanwrite(toPtr, size)
	}
	if asanenabled {
		asanread(fromPtr, size)
		asanwrite(toPtr, size)
	}
    // 拷贝小优化 size = 1总共只拷贝1个字节
	if size == 1 {
		*(*byte)(toPtr) = *(*byte)(fromPtr)
	} else {
		memmove(toPtr, fromPtr, size)
	}
	return n
}
```

## 快速创建 []byte, 不初始化清零内存

```go
func bytealg_MakeNoZero(len int) []byte {
	if uintptr(len) > maxAlloc {
		panicmakeslicelen()
	}
    // 把申请的字节大小向上对齐到内存分配器的span块
	cap := roundupsize(uintptr(len), true)
    //mallocgc(cap, nil, false) no-zero分配， 不做内存清零
    //unsafe.Slice((*byte)(...), cap) 把这块内存当成 []byte
    //[:len] 取前len个元素
	return unsafe.Slice((*byte)(mallocgc(cap, nil, false)), cap)[:len]
	return unsafe.Slice((*byte)(mallocgc(cap, nil, false)), cap)[:len]
}

```

## moveSlice把切片底层数组复制到新分配的堆内存

> 切片逃逸， runtime调用moveSlice， 把底层数组拷贝到堆

```go
func moveSlice(et *_type, old unsafe.Pointer, len, cap int) (unsafe.Pointer, int, int) {
	if cap == 0 {
		if old != nil {
			old = unsafe.Pointer(&zerobase)
		}
		return old, 0, 0
	}
    //`capmem`：旧切片容量对应的总字节大小 = cap × 单个元素大小。
	capmem := uintptr(cap) * et.Size_
	new := mallocgc(capmem, et, true)
    //GC写屏障
	bulkBarrierPreWriteSrcOnly(uintptr(new), uintptr(old), capmem, et)
	memmove(new, old, capmem)
	return new, len, cap
}

```

## moveSliceNoScan 只用于无指针元素的切片

- 把整个底层数组迁移到新的noscan堆内存，保留原来的len, cap
- 是moveSlice简化版本,**没有 GC 类型元数据、没有写屏障**。

```go
func moveSliceNoScan(elemSize uintptr, old unsafe.Pointer, len, cap int) (unsafe.Pointer, int, int) {
	if cap == 0 {
		if old != nil {
			old = unsafe.Pointer(&zerobase)
		}
		return old, 0, 0
	}
	capmem := uintptr(cap) * elemSize
    // 第三个参数false, 没有GC
	new := mallocgc(capmem, nil, false)
	memmove(new, old, capmem)
	return new, len, cap
}

```

## moveSliceNoCap搬迁切片底层数组到堆， 不用原来切片的旧cap

```go
func moveSliceNoCap(et *_type, old unsafe.Pointer, len int) (unsafe.Pointer, int, int) {
	if len == 0 {
		if old != nil {
			old = unsafe.Pointer(&zerobase)
		}
		return old, 0, 0
	}
	lenmem := uintptr(len) * et.Size_
	capmem := roundupsize(lenmem, false)
	cap := capmem / et.Size_
	new := mallocgc(cap*et.Size_, et, true)
	bulkBarrierPreWriteSrcOnly(uintptr(new), uintptr(old), lenmem, et)
	memmove(new, old, lenmem)
	return new, len, int(cap)
}
```

## moveSliceNoCapNoScan

> 搬迁切片底层数组到新的 noscan 堆内存；**只拷贝 len 个有效元素**；分配器对齐多出的那一段内存，手动清零。

```go
func moveSliceNoCapNoScan(elemSize uintptr, old unsafe.Pointer, len int) (unsafe.Pointer, int, int) {
    if len == 0 {
        if old != nil {
            old = unsafe.Pointer(&zerobase)
        }
        return old, 0, 0
    }
    lenmem := uintptr(len) * elemSize
    capmem := roundupsize(lenmem, true)
    new := mallocgc(capmem, nil, false)
    memmove(new, old, lenmem)
    if capmem > lenmem {
        memclrNoHeapPointers(add(new, lenmem), capmem-lenmem)
    }
    return new, len, int(capmem / elemSize)
}
```

## 栈缓冲区的切片扩容growsliceBuf

> 普通`growslice`扩容时会在堆上分配新内存；`growsliceBuf`优先**复用传入的栈上缓冲区（bufPtr，必须在栈上）**，只有放不下的时候才降级走普通`growslice`堆扩容。

```go
func growsliceBuf(oldPtr unsafe.Pointer, newLen, oldCap, num int, et *_type, bufPtr unsafe.Pointer, bufLen int) slice {
	if newLen > bufLen {
		return growslice(oldPtr, newLen, oldCap, num, et)
	}
	oldLen := newLen - num
	if oldPtr != bufPtr && oldLen != 0 {
        // 把旧切片的oldLen个元素拷贝到栈缓冲区头部
		memmove(bufPtr, oldPtr, uintptr(oldLen)*et.Size_)
	}
	newCap := int(roundupsize(uintptr(newLen)*et.Size_, !et.Pointers()) / et.Size_)
	if newLen < newCap {
		memclrNoHeapPointers(add(bufPtr, uintptr(newLen)*et.Size_), uintptr(newCap-newLen)*et.Size_)
	}
	return slice{bufPtr, newLen, newCap}
}

```

## growsliceBufNoAlias

> **先用栈缓冲区扩容切片；在开启 RuntimeFreegc 实验特性且满足条件时，主动释放旧切片底层堆内存**。

```go
func growsliceBufNoAlias(oldPtr unsafe.Pointer, newLen, oldCap, num int, et *_type, bufPtr unsafe.Pointer, bufLen int) slice {
	s := growsliceBuf(oldPtr, newLen, oldCap, num, et, bufPtr, bufLen)
	if goexperiment.RuntimeFreegc && oldPtr != bufPtr && oldPtr != nil && oldPtr != s.array {
		noscan := !et.Pointers()
		freegc(oldPtr, uintptr(oldCap)*et.Size_, noscan)
	}
	return s
}

```
