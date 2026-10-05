## QPlainTextEdit

> qt的纯文本编辑控件， 适合代码编辑器，支持大文本

```cpp
#include <QPlainTextEdit>

// Q_OBJECT Qt 元对象宏，**只要用到信号槽、必须加**；加了之后代码要走 `moc` 预处理器。
```

## QTextDocument 文档模型， 文本内容， 格式都在这个独立文档对象里。

## `QSyntaxHighlighter`：Qt 提供的**语法高亮基类**，

## `QTextCharFormat`：文本格式类，用来设置**颜色、字体粗细**。比如关键字蓝色加粗，注释绿色。

```cpp
- `setForeground`：设置文字前景色（字体颜色）。
- `setFontWeight`：字体加粗。
```

## `QRegularExpression`：Qt6 推荐的正则表达式类（Qt5 旧版是 QRegExp），用来匹配关键字、注释、字符串。

## ` <QTextStream>`：Qt 的文本流类，用来读写**文本文件**，自动处理字符编码转换（默认 UTF-8，可手动设置）

## **QTabWidget = 标签栏 (QTabBar) + 堆叠页面 (QStackedWidget)**。

多个页面叠在一起，同一时间**只显示 1 个页面**

## **QTabWidget = 标签栏 (QTabBar) + 堆叠页面 (QStackedWidget)**。

多个页面叠在一起，同一时间**只显示 1 个页面**

## ## QFileSystemModel（模型 Model，重点）

> 继承自 `QAbstractItemModel`，Qt**内置的文件系统模型**。
