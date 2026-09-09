```ts
// 基础类型
let name: string
let age: number
let ok: boolean

// 数组
let users: User[]

// interface
interface User {
    id: number
    name: string
}

// type
type Status = "pending" | "success" | "failed"

// 联合类型
let id: number | string

// 函数
function add(a: number, b: number): number {
    return a + b
}

// 泛型
function get<T>(value: T): T {
    return value
}

// 可选属性
interface User {
    id: number
    name?: string
}

// Record
const users: Record<string, User> = {}

// 类型缩小
if (typeof id === "string") {
    // id 是 string
}
```

| 特性 | HashRouter | BrowserRouter |
|---|---|---|
| URL 格式 | `example.com/#/go` | `example.com/go` |
| 服务器配置 | 不需要 | 需要配置 fallback |
| 适用场景 | 静态站点、GitHub Pages | 动态服务器 |