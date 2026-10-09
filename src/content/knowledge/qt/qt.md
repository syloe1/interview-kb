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

## 串口

> 串口是一种串行通信接口，用于上位机和下位控制器、传感器近距离通信。比如机器人上位机通过串口下发运动控制指令，同时接收下位机回传的电机位置、传感器数据
> `#include <QApplication>`：Qt GUI 程序**必须**的核心类，管理 GUI 事件循环、系统资源、应用全局配置。

## 创建QT应用实例

> QApplication app(argc, argv);
> 启动Qt事件循环，阻塞在这里，直到窗口关闭，返回退出码
> return QApplication::exec();

## 实例化主窗口对象MainWindow

> MainWindow w;
> w.show()

## 设置软件的组织名， 应用名

- 组织名：`QApplication::organizationName()`
- 应用名：`QApplication::applicationName()`

## QMainWindow

`MainWindow` 继承 `QMainWindow`，Qt 主窗口框架（自带菜单栏、状态栏、中心 widget）。

## 小组件

- QCheckBox 是那种勾选框
  setChecked(true) 默认勾选
- QComboBox 是下拉可选框
  addItem增加可选
  addItem(男)
  addItem(女)
- QSpinBox 是两个箭头调整的
  setRange设置数值范围
- QLineEdit 编辑框
- QPushButton是点击按钮
  ->setEnabled(false) 默认停止按钮
- QLabel 是标签
  setAlignment设置对齐
  setMinimumSize 设置大小
  setStyleSheet 设置背景
- QPlainTextEdit 是那种终端输出框
- QToolBar 是工具栏
  setMovable(false) 不能拖拽移动
- QVBoxLayout 是凹下去的块
- QGroupBox 是圈起来的块
- QStringLiteral是文本框里面默认的字体
- `QScrollArea`：图像太大的时候，可以滚动画面
- `statusBar()`：窗口最底部状态栏，放 FPS、分辨率标签
- QFormLayout 专门做「左文字标签 + 右输入控件」两列表单布局管理器
  addRow添加一行，一行 = 标签 + 输入控件
- QDockWidget = 可停靠悬浮面板.
- arg(数值, 最小宽度, 格式字符, 小数位数)
- `QPixmap`：Qt 用于**在屏幕上绘制**的图像类型，适合 UI 控件显示
- QTimer
  ->setInterval设置刷新频率

## 属性

- setWindowTitle 设置标题
- resize() 设置窗口大小
- addWidget去增加组件

## connect( sender, &SenderClass::signalName, receiver, &ReceiverClass::slotFunc );

| 参数序号 | 含义                              | 解释                         | 示例                        |
| -------- | --------------------------------- | ---------------------------- | --------------------------- |
| 1        | sender：信号发送者对象指针 / 引用 | 谁在发射信号（信号源）       | `&pipeline_` / `transport_` |
| 2        | 信号地址：`&类名::信号名`         | 指定发送对象要发射哪一个信号 | `&Pipeline::frameReady`     |
| 3        | receiver：接收者对象指针          | 谁来接收、处理这个信号       | `this`（MainWindow 实例）   |
| 4        | 槽函数地址：`&接收类::槽函数名`   | 收到信号后执行的回调函数     | `&MainWindow::onFrame`      |

## signals vs slots:

- **`signals:` 信号：我这边发生了一件事，我对外喊一声，通知别人。只声明，不用写实现。**
- **`private slots:` 槽：用来接收别人发过来的信号，收到之后执行一段代码（函数）。**
- slots 本质就是**可以被信号触发的普通成员函数**

> Qt 信号槽本质：**事件通知机制，用来解耦模块，跨线程通信**。
> `sender` 发射信号 → 绑定好的 `receiver` 的槽函数自动跑起来。

## go vs cpp 可读性

> Go 把底层平台差异全部封装进 runtime，用户代码看不到；C++ 没有标准库提供这层 runtime，底层库（像 Qt）只能自己用 `#ifdef` + 内联汇编去抹平操作系统 / CPU 架构差异，于是就出现了你贴的这种 “丑陋代码”。

## namespace {} 匿名命名空间， 让里面的东西只在这个.cpp文件里运行。
