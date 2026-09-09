## 一、本地新项目关联远程（第一次上传）

bash

运行

`# 1. 进入项目目录
cd 你的项目目录

# 2. 初始化本地仓库

git init

# 3. 把当前所有文件加入暂存

git add .

# 4. 提交到本地仓库

git commit -m "init"

# 5. 重命名主分支为 main

git branch -M main

# 6. 关联远程仓库

git remote add origin https://github.com/syloe1/toy.git

# 查看远程

git remote -v

# 7. 推送到远程 main 分支

git push -u origin main

# 等价

git push --set-upstream origin main`

## 二、拉取已有仓库（第一次下载代码）

bash

运行

`# 克隆远程仓库到本地
git clone https://github.com/syloe1/mall.git

# 进入项目目录

cd mall

# 切到主分支

git checkout main

# 拉取最新代码

git pull`

## 三、日常开发流程（主分支 → 新建分支 → 开发 → PR）

bash

运行

`# 1. 切回主分支并拉最新
git checkout main
git pull

# 2. 新建并切换到自己的功能分支

git checkout -b feature/xxx

# 3. 开发完成后提交

git add .
git commit -m "feat: 完成xxx功能"

# 4. 推送到远程同名分支

git push origin feature/xxx

# 5. 去 GitHub 网页端提 PR（Pull Request）

# 审核通过后合并到 main`

## 四、常用命令速查

bash

运行

`git status          # 查看当前状态（常用）
git add .           # 添加所有修改
git commit -m "msg"# 提交
git pull            # 拉取最新
git checkout main   # 切主分支
git checkout -b 分支名 # 新建分支
git push origin 分支名 # 推分支`
