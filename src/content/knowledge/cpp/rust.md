## let定义的变量默认不可变

```rust
let x = 3;
let mut x = 3;
// mut可以加入形参里面
```

## Rust 是静态强类型语言，变量一旦确定类型，**不能换成别的类型**。

```rust
// 通过变量覆盖
let num = "three"
let num = 3;
```

## Rust 里声明常量需要**标注类型**，语法是 `const 常量名: 类型 = 值;`

```rust
const NUMBER: i32 = 3;
```

## Rust 数组写法：`[值; 长度]`，`[42; 100]` 代表：创建包含 100 个`42`的数组。

## Rust 切片语法：`&数组[起始索引..结束索引]`

## Rust元组解构

```Rust
let (name, age) = cat;// 就是解构
```

## 元组用 `.数字` 访问元素，**不是方括号 []**（数组 / 切片才用 []）

## 向量宏语法：`vec![元素1,元素2,...]`

## `for element in input` 这里的 `element` 是**引用 &i32**，要先解引用 `*element`，乘以 2，再 `push` 进 output。

```rust
let mut output = Vec::new();


output.push(*element * 2);

```

## input.iter ().map (|element| *element * 2).collect () 看不懂

```rust
//`|element| { ... }` → Rust **闭包**，相当于一个临时小函数
//`.collect()`：**消费迭代器，把所有转换后的结果收集起来，装进容器**
let mut output = Vec::new();
for element in input.iter() {
    output.push(*element * 2);
}
output

```

## `vec0.clone()` 创建新向量 `[22,44,66]`

- 深拷贝，完整复制一份 Vec 到堆上

## `&String`：**不可变借用**，只是读，不接管 `data` 的所有权
