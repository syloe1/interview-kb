## 确认wk目录权限
```bash
ls -l /home/wk

正常输出：`drwxr-xr-x 5 wk wk ... /home/wk`
如果权限不对，执行：

sudo chown -R wk:wk /home/wk
sudo chmod 755 /home/wk

```     

## 查看ubuntu IP
```bash
ip a
```

## 配置公钥
```bash
# 生成密钥（一路回车）
ssh-keygen
# 推送公钥到ubuntu wk用户
ssh-copy-id wk@192.168.x.x

```

## 安装一些东西
```bash
# 安装node
sudo apt install build-essential cmake git libssl-dev pkg-config g++ gcc tmux
```
## 配置public key
```bash
cat ~/.ssh/id_rsa.pub

# 进入wk的ssh目录
mkdir -p ~/.ssh
# 创建authorized_keys文件，粘贴公钥
nano ~/.ssh/authorized_keys

chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys

ssh wk@192.168.x.x

```
## 安装claude 
```bash
# 安装claude
curl -fsSL https://claude.ai/install.sh | bash
```

## 写入path
```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc

```


## nvm安装Node22
```bash
# 1. 安装 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash

# 2. 加载环境变量到当前终端
source ~/.bashrc

# 3. 安装 Node 22（自带npm）
nvm install 22

# 4. 启用node22
nvm use 22

```
## 安装codex
```bash
npm install -g @openai/codex

```

## 配置nvim
```bash

```