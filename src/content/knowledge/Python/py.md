## __init__.py给父目录文件夹标记成Py包
- __all__ 定义 * 导入， 会导入哪些名字

## @dataclass(frozen=True)
- frozen=True不可变对象

## append vs extend 
- `append(xxx)`：**把传入的整个东西当成【一个元素】追加到列表末尾**
- `extend(xxx)`：**把传入的可迭代对象里面的每一个元素，逐个拿出来追加进列表**
