gh pr list --state all --search "author:@me"
vscode ctrl + p打开文件， ctrl + g跳转行号
git pull origin main 拉取合并

修 bug Fixes #123
完成 feature Closes #123
完成文档任务 Closes #123
解决讨论/设计问题 Resolves #123

git branch --show-current看目前分支
git branch 看全部分支

# 添加你自己的Github仓库，远程名叫 myorigin

git remote add myorigin https://github.com/syloe1/6.1810.git
小改动提交
git commit --amend --no-edit
git push --force-with-lease 分支

改完文件记得通gofmt -w xxx.go格式化

# 切到本地main

git checkout main

# 拉取上游更新

git fetch upstream

# 同步上游main

git rebase upstream/main

# 更新你自己fork仓库的main分支

git push origin main

# 新建bug修复分支

git checkout -b fix/strip-setup-ticket-ids

# 开始修改代码、调试

# 开发完成后：add -> commit -> push到自己fork

git push origin fix/strip-setup-ticket-ids

# 然后网页打开fork仓库，创建Pull Request

判断有没有commit
git log --oneline -1

配置远程官方
git remote add upstream https://github.com/kprompt/kprompt-website.git
git fetch upstream
git checkout -b docs/add-xai-provider upstream/main

内容 ## Summary ## Changes ## Test plan

放弃格式化文件

# 先把你真正改的 5 个文件暂存起来（保护它们不被覆盖）

git add README.md cmd/kprompt/main.go docs/providers.md internal/llm/presets.go internal/llm/presets_test.go

# 然后放弃所有其他文件的改动（恢复原样）

git checkout -- .

git checkout -b fix/strip-setup-ticket-ids

1. Fork 上游官方仓库到个人 GitHub 账号
2. Clone【个人 fork 后的仓库】到本地
3. 配置双 remote：
   - origin：指向自己 fork 仓库（git remote add origin xxx/xxx.git）
   - upstream：指向原始官方仓库（git remote add upstream 官方仓库地址）
4. 开发前置同步（保证代码基于最新上游主干）
   git checkout main
   git fetch upstream
   git merge upstream/main // 本地main同步上游最新代码
5. **新建独立功能分支开发（关键！禁止在main分支写代码）**
   git checkout -b feat/xxx 或者 fix/bug-name
6. 编码、自测后提交 commit（遵循规范提交信息）
7. git push origin feat/xxx 推送【功能分支】到个人fork
8. 打开 GitHub 网页，从个人fork的功能分支向上游仓库发起 Pull Request
9. 根据 maintainer 评审反馈，在同一分支追加提交，持续推送更新 PR
10. PR 合入上游后，本地清理开发分支，下次开发重复同步流程

# **不需要本地改动，直接丢弃本地所有修改，完全覆盖为远程最新代码**

> ⚠️ 危险操作！本地所有未提交改动全部清空，谨慎执行

```
# 丢弃已修改文件
git reset --hard HEAD
# 删除未跟踪的新增文件（docs/dash.md这类）
git clean -fd
# 然后拉取
git pull origin main
``



git stash 暂存更改

git stash list

git stash apply 恢复
git stash apply stash@{1}

git stash pop 恢复缓存 + 直接删掉这条缓存

git stash clear清除所有的stash缓存
```

```
1. 建立仓库
2. 不用勾选 add a readme add gitignore choose a liense
3. copy url
4. cd 目录 git init
git add .
git commit -m "init"
git remote add origin 你复制的链接
git branch -M main
git push -u origin main、


//internship
git clone 仓库地址

git checkout main
git pull

新建自己分支
git checkout -b feature/syloe-login
git commit -m "feat: 完成登录页面"
git push origin 自己的分支名


去提交PR
github -> Pull Request (PR)

切回主分支
拉最新代码
从主分支新开功能分支
开发 → commit → push
提 PR → 审核 → 合并
git checkout main
git pull
git checkout -b feature/新功能


git clone          # 第一次下载
git checkout main  # 切主分支
git pull           # 拉最新代码
git checkout -b 分支名  # 新建自己的分支
git add .          # 添加所有修改
git commit -m "信息"  # 提交
git push origin 分支名 # 推到远程
git status         # 查看当前状态（非常常用）
git branch -M main
git remote add origin https://github.com/syloe1/toy.git

git push --set-upstream origin main


```
