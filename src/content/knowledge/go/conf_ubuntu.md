### 配置root密码

```bash
sudo passwd
```

### 给ubuntu配置SSH

```bash
sudo apt update
sudo apt install -y openssh-server
sudo systemctl enable --now ssh
# 查看服务状态
systemctl status sshd
# 查看ip 地址
sudo apt install net-tools
ip a
```

## ssh连接

```bash
# ssh 你的Ubuntu用户名@虚拟机IP
ssh wk@192.168.142.143
```

## 配置ssh密钥认证

```bash
# powershell
ssh-keygen -t ed25519 -C "vmware-ubuntu"
# 确认密钥在哪里
Get-Location
Get-ChildItem .\yes*
## scp传过去
scp C:\Users\WK112\yes.pub wk@192.168.142.143:/tmp/windows_vmware.pub
# ssh连接虚拟机
ssh wk@192.168.142.143
# 创建配置
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
cat /tmp/windows_vmware.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
rm /tmp/windows_vmware.pub
exit
# 验证密钥
ssh -i C:\Users\WK112\yes -o IdentitiesOnly=yes wk@192.168.142.143
## 在配置文件中
notepad "$env:USERPROFILE\.ssh\config"
# 添加
Host ubuntu-go
    HostName 192.168.142.143
    User wk
    IdentityFile C:/Users/WK112/yes
    IdentitiesOnly yes
# ssh连接
ssh ubuntu-go
```

## 看磁盘总容量， 已用和剩余空间

```bash
# 扩展磁盘， sudo frowpart /dev/sda 3 扩展分区
# 扩展文件系统 sudo resize2fs /dev/sda3
# 验证 lsblk df -h /
df -h / #看自己哪个分区
df -h
df -i #看是否有充足的inode
lsblk
sudo parted /dev/sda unit GiB print free
# 确认文件系统类型
df -T /
# 扩展分区
sudo apt install -y cloud-guest-utils
# 扩展第3个分区
sudo growpart /dev/sda 3
# 检查lsblk
/dev/sda3 应该从约 24.5 GB 扩展到接近 69 GB。
# 扩展文件系统 ext4
sudo resize2fs /dev/sda3
```

### 看ubuntu什么架构

```bash
uname -m
# - 输出 `x86_64` → AMD64，用 `server-linux-x64`
# - 输出 `aarch64` → arm64，用 `server-linux-arm64`
# 下载vscode stable版本
https://update.code.visualstudio.com/commit:e646868227c3e3a9e3f24277c8c7220be42c0be7/server-linux-x64/stable
## 虚拟机配置
COMMIT="e646868227c3e3a9e3f24277c8c7220be42c0be7"
mkdir -p ~/.vscode-server/bin/${COMMIT}
cd ~/.vscode-server/bin/${COMMIT}
# 如果你已经scp传到/tmp了
mv /tmp/vscode-server-linux-x64.tar.gz .
tar -zxf vscode-server-linux-x64.tar.gz --strip-components=1
touch vscode-scp-done.flag
```

## 给ai的prompt

```txt
任务：规划 Ubuntu 22.04 Go 开源项目与云原生开发环境
一、背景
我刚在 VMware 中安装了 Ubuntu 22.04，准备把它作为长期使用的独立开发实验环境。
我通过 Windows + VS Code Remote-SSH 连接这台 Ubuntu，并希望使用 Codex 辅助配置环境、阅读开源项目、编写代码和运行云原生实验。
请先进入计划模式，只检查现状并输出规划文档，暂时不要执行实际安装和修改。
二、学习目标
1. 深入学习 Go 语言和标准库源码。
2. 阅读 Gin 等 Go 开源项目的源码。
3. 学习 Linux、TCP/IP、进程、线程、并发和网络编程。
4. 学习 Docker、容器网络、镜像构建和容器编排。
5. 后续逐步学习 Kubernetes、Kind、Helm、Prometheus 等云原生技术。
6. 能够独立克隆、编译、测试、调试和分析 Go 开源项目。
三、环境配置目标
请规划以下模块，明确依赖关系和安装顺序。
模块 A：基础开发环境
- 系统信息检查与软件包更新
- Git、curl、wget、编译工具链
- zsh 或 Bash 的合理配置，避免不必要的美化
- tmux、vim 或 Neovim（按需安装）
- SSH 服务、密钥认证与连接验证
- 常用目录结构
模块 B：Go 开发环境
- 选择适合 Ubuntu 22.04 的 Go 稳定版本
- 正确配置 GOROOT、GOPATH、PATH
- 配置 Go Modules 和依赖下载
- 配置 Go 代理，考虑网络可达性
- 安装 gopls、delve 等开发工具
- 验证 go version、go env、go test 和 go build
不要直接使用未经验证的旧版安装教程。安装前检查当前官方支持的版本和安装方法。
模块 C：源码阅读与调试
- 规划 Go 标准库源码目录
- 支持源码跳转、测试、基准测试和调试
- 为 net、sync、context、encoding、runtime 等包提供学习工作流
- 为 Gin 等开源项目提供统一的克隆、测试和源码阅读目录结构
模块 D：容器环境
- Docker Engine 和 Docker Compose
- 普通用户运行 Docker 的权限与安全风险
- 镜像拉取、构建、网络、卷、日志与故障排查
- 后续使用 Kind 或 k3d 创建本地 Kubernetes 集群
- 预留 Redis、MySQL、消息队列和监控组件的实验能力
不要一次性安装所有中间件和集群。先规划最小可用环境，再分阶段扩展。
模块 E：工程化工具
- Makefile
- golangci-lint
- 单元测试、基准测试与竞态检测
- Dockerfile、多阶段构建
- Git 分支、Issue、PR 和提交规范
- 项目 README、实验记录和技术博客目录
模块 F: AI 工具
- claude-cli
- codex-cli
四、规划要求
1. 首先检查系统版本、CPU 架构、磁盘空间、内存、网络和现有软件。
2. 不要假设系统是全新且没有任何已安装的软件。
3. 不要覆盖现有配置，不要擅自修改 SSH 安全策略。
4. 不要直接使用 sudo 运行远程下载的脚本。
5. 优先采用官方文档和可重复执行的安装步骤。
6. 区分必须安装、建议安装和后续按需安装的组件。
7. 说明每个组件的作用、资源消耗、潜在冲突和验证方式。
8. 考虑 VMware 的磁盘、内存和 CPU 限制。
9. 对涉及 sudo、系统配置、Docker 权限和安全策略的操作，提前说明影响。
10. 每个阶段都必须有验证步骤和失败时的排查方案。
五、需要生成的文档
在工作目录中新建 ubuntu-go-lab/，先生成规划文档，不要在系统根目录随意创建文件。
- README.md：实验环境目标和整体说明
- SOP.md：环境初始化与日常使用标准操作流程
- task.md：可勾选的任务清单，标注优先级、依赖、验收条件
- docs/architecture.md：环境架构与目录设计
- docs/troubleshooting.md：常见故障和排查方法
如果当前工作目录不适合存放这些文件，请先说明建议位置，不要擅自修改其他目录。
六、执行约束
当前阶段只允许读取系统信息、检查现有环境、分析依赖并编写规划文档。
禁止执行软件安装、系统升级、重启服务、修改 SSH 配置、修改防火墙、修改网络配置或执行具有破坏性的命令。
完成规划后，请汇报：
1. 当前环境检查结果。
2. 推荐的安装顺序。
3. 生成的文档及其路径。
4. 尚需我确认的高风险决策。
5. 下一阶段建议执行的任务。
完成后停止，等待我审核计划，再进入执行阶段。
```
