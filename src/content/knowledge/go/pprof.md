# 格式：go tool pprof 服务地址

```go
go tool pprof http://127.0.0.1:6060/debug/pprof/xxx
```

| 指令                     | 作用                                        |
| ------------------------ | ------------------------------------------- |
| `top`                    | 查看**排名**（默认按耗时 / 内存排序）       |
| `list 函数名`            | 查看函数**逐行代码**耗时 / 内存             |
| `web`                    | 打开浏览器，查看调用关系图（依赖 Graphviz） |
| `svg`                    | 生成 svg 图片（手动打开）                   |
| `quit`                   | 退出终端                                    |
| `top -flat` / `top -cum` | 切换排序规则                                |
|                          |                                             |
|                          |                                             |

## CPU采样终端

```go
# 采样 30 秒 CPU 数据，进入交互终端
go tool pprof http://127.0.0.1:6060/debug/pprof/profile
```
