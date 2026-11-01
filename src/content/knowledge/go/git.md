## dev主分支工作流程

```txt
dev作为集成分支
	开启新服务
		git checkout dev && git pull
		go checkout -b feature/xxx.service
	随便改
		git add. git commit -m "basic" git commit -m "jwt"
		git checkout dev
		// 把user分支合并进来
		git merge --squash feature/user-service
		git push
```

### rebase

```
# 1. 先切到自己的分支
git checkout feature-5-fuck
# 2. 拉取远程所有更新（不会自动合并）
git fetch origin
# 3. 把当前分支（feature-5-fuck）的提交，搬到 origin/dev 的顶端
git rebase origin/dev

```

## Gh Auth

```


# 1. 先去 GitHub 生成 token：https://github.com/settings/tokens
#    Generate new token (classic)，勾选 repo 权限，复制 token

# 2. 登录（把 YOUR_TOKEN 换成你刚复制的）
echo "" | gh auth login --with-token

# 3. 配置 git
git config --global user.name ""
git config --global user.email ""

# 4. 验证
gh auth status

```

## Git 命令

```txt
//查看最新提交
git show HEAD

//查看完整提交日志
git log
git log --oneline

# 展示每条修改的文件
git log --oneline --stat

# 只看 dev 分支最近 10 条
git log --oneline -10 dev

# 1. 看当前工作区状态
git status

# 2. 检查空白格式问题（CI/代码评审高频卡点）
git diff --check
# 有输出=有坏空白，要修复；无输出=ok

# 3. 看【暂存区】的改动（重点！很多人搞错：git diff 默认看未add的）
git diff --staged
# 如果你已经 add 了，不加 --staged 看不到！

# 4. 看整个分支相对于目标分支（main/master）的全部改动（最适合PR自查）
# 假设你目标分支是 main
git diff main...HEAD

 git diff > diff.txt && code diff.txt

```

## Git Issue

> 这个需求到底要解决什么问题？正常流程是什么？异常怎么办？数据如何保持一致？

```txt
1. 删除分支
    git branch -d 分支名
2. 添加远程仓库
    git init  git remote add origin url
3. 替换远程仓库
    git remote set-url origin url
4. Linux命令
    cp -iv AGENTS.md ./go-shell-tool/
    -i 覆盖前确认 -v 打印复制了什么 -r 递归复制目录
```

## 解决 issue思路

```txt
1. 【读懂需求】issue 要解决什么？是新增功能？修复 bug？新增单元测试？约束是什么（能不能改源码？只准加测试？）
2. 【识别被测对象】被测模块有哪些对外 API？写出接口签名 + 对外承诺（契约）
3. 【黑盒推导用例】只看接口，不看源码：
   - 正常流程（happy path）
   - 边界输入
   - 异常操作（提前 cancel、0 参数、重复定时器）
4. 【读源码，白盒补充用例】
   - 梳理内部核心数据结构（堆、set、activeTimers_）
   - 找所有 if/else 分支、特殊标记、并发场景
   - 重点：**回调内部调用组件自身 API**（Reactor 类组件高频坑）
5. 【识别风险点】线程模型？哪些操作必须在 loop 线程？跨线程是否安全？对象生命周期？悬垂指针 / 双重释放？
6. 【测试夹具设计】要不要单独起 EventLoop？每个 test 独立环境还是复用？
7. 【用例清单汇总】区分：基础黑盒用例 / 白盒高危分支用例
8. 【反向验证方案】怎么证明我的测试不是假阳性？改坏代码，测试能变红吗？
9. 【PR 清单】改动文件、CMake、测试命令、PR 描述要点
```

## 终端 gh

```txt
    gh auth login
	gh auth status
分支命名模板 <type>/<issue-number>-<short-description>
	feat  feature新功能
	fix    bug修复
	refactor 重构
	docs
	test
	chore  杂项

网页开PR
gh PR流程
	1.开PR
	gh pr create --base dev --title "..." --body "..."

	2. 合并 + 清理
	# squash合并：把本分支所有commit压缩成1个commit并入dev
	gh pr merge --squash --delete-branch
	# 手动关闭issue（如果PR写了Closes #1，合并后会自动关，这条可以省略）
	gh issue close 1 -c "已在 #N 完成"

	3.
	删除分支   git branch -d 分支名
	删除远程分支 git push origin --delete 分支名

	4. 验证：工作区应该是干净的
		git status --short
		git log --oneline -2
review
查看PR代码diff，自检
    gh pr diff

合并 显式指定 PR 号）：
	 gh pr merge 5 --squash --delete-branch
# 查看本地dev最新提交，看squash后的commit
git log -1

# 去网页看PR #5，状态已经变成 Merged
gh pr view 5

# 检查Issue #1，因为PR写了Closes #1，已经自动closed
    gh issue view 1
## 快速浏览 PR 详情（屏蔽警告）
	gh pr view 5 --json title,state,number
创建issue gh issue create --title "" -- body ""

看pR列表
	gh pr list --state merged
看 x PR的详情
    gh pr view x
    gh pr view x --web
```

### PR流程

```txt
 1. 回主分支同步
	git checkout dev && git pull --ff-only origin dev
 2. 开分支
	git checkout -b build/1-lib-target
 3. 写
    coding review coding ....
 4. 验证
	gofmt -l .            # 应无输出
	go vet ./...          # 必须通过（现在失败）
	go test ./...         # 必须通过
	go test -race ./...
 5. 提交
	git status 查看改动文件
	git add
	git commit -m "  "
 6. 推送
	git push -u origin 分支
```

## PR模板

```md
## Description

Fix #xxx

This PR fixes two bugs:

1. xxx
2. xxx

Changes:

- xxx
- xxx

## Test

`go test ./...` and `go vet ./...` pass.

- TestA
- TestB
```

### bash 显示git分支

```txt
# 查看是哪种bash echo $0
# 在 .bashrc追加
	parse_git_branch() {
	  git branch 2>/dev/null | sed -n 's/^\* \(.*\)/ (\1)/p'
	}

	export PS1='\[\033[32m\]\u@\h \[\033[33m\]\w\[\033[36m\]$(parse_git_branch)\[\033[0m\]\$ '
```
