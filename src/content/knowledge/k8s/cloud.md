# Kubernetes 基础笔记

## kubectl 简介

kubectl 是 Kubernetes 的命令行工具，用来对集群资源做增删改查、部署应用、查看日志等操作。

### 查看客户端版本

```bash
kubectl version --client
kubectl version --client --output=yaml
1. **Deployment**
作用：管理一组 Pod，支持滚动更新、扩缩容、版本回滚。
2. **Service**
作用：为一组 Pod 提供统一访问入口，实现负载均衡 + 集群内服务发现。

>
> 一句话区分：Deployment 负责管控 Pod；Service 负责给 Pod 分发流量。
```

# Kubernetes Deployment 常用命令笔记

> 资源示例：`deployment/kubernetes-bootcamp`

## 查看 Deployment

```bash
# 查看所有 deployment
kubectl get deployments

# 查看滚动更新状态
kubectl rollout status deployment/kubernetes-bootcamp

# 查看 deployment 关联的 replicaset(rs)
kubectl get rs

- `Desired`：期望副本数
- `AGE`：应用运行时长

## 查看 Pod 标签

```

kubectl get pods --show-labels

```

## 版本历史 & 回滚

```

# 查看滚动更新历史记录

kubectl rollout history deployment/kubernetes-bootcamp

# 回滚到上一个版本

kubectl rollout undo deployment/kubernetes-bootcamp

```

## 扩缩容

```

# 修改副本数，扩容到10个

kubectl scale deployment/kubernetes-bootcamp --replicas=10

```

## 暂停 / 恢复上线（金丝雀发布常用）

```

# 暂停滚动更新

kubectl rollout pause deployment/kubernetes-bootcamp

# 持续观察 rs 变化（实时刷新）

kubectl get rs --watch

```

### 补充说明

- `rs` = ReplicaSet，由 Deployment 自动创建，用来管理 Pod 副本
- rollout 系列命令：管控 Deployment 的发布、暂停、回滚、查看状态
- `--watch`：持续监听资源变化，终端实时刷新


```

````
# Kubernetes Pod 基础笔记
## 核心概念
Pod 是 K8s 调度的**最小单元**（不是容器）
> 类比：不是虚拟机，Pod 是一组共享命名空间、共享网络、共享文件系统的容器集合。
一个 Pod 里面可以放多个容器，Pod 内容器之间互通，外部不能直接单独调度容器。

## K8s YAML 通用结构
```yaml
apiVersion:  # API版本
kind:        # 资源类型（Pod / Service / Deployment）
metadata:    # 元数据：名字、标签、注解
spec:        # 期望状态描述
````

## 常用命令

```
# 应用yaml文件创建资源
kubectl apply -f xxx.yaml

# 查看pod列表
kubectl get pod

# 查看pod详细信息（事件、状态、镜像）
kubectl describe pod pod名称

# 进入pod容器内部交互终端
kubectl exec -it pod名称 -- /bin/bash
```

## 补充理解

- 金丝雀发布：先部署部分流量，验证上线，没问题再全量推送
- Pod 是短暂的，Pod 销毁重建后 IP 会变化，所以要用 Service 做固定访问入口

````
# Kubernetes Pod YAML & 优先级笔记
## Deployment 模板嵌套结构
```yaml
spec:
  template:
    spec:
      containers:
      - name: hello    # 容器名称
        image: xxx     # 容器镜像
        ports:
        - containerPort: 80  # 容器监听端口
````

> 说明：Deployment 里通过 `template` 定义 Pod 模板，控制器按照模板批量创建 Pod。

## PriorityClass（Pod 优先级）YAML 示例

```
apiVersion: scheduling.k8s.io/v1
kind: PriorityClass
metadata:
  name: pod名字
value: 10000
globalDefault: false
preemptionPolicy: Never
```

- `value`：优先级数值，数字越大优先级越高
- `globalDefault`：是否作为集群默认优先级
- `preemptionPolicy: Never`：不抢占低优先级 Pod 资源

## 常用命令

```
# 删除资源（通过yaml文件）
kubectl delete -f simple.yaml

# 查看Pod详细事件、报错信息
kubectl describe pod pod名称

# 查看容器日志
kubectl logs pod名称

# 进入Pod容器终端
kubectl exec -it pod名称 -- /bin/bash
```

> 补充：Pod 可以设置优先级，高优先级 Pod 在资源紧张时可以抢占低优先级 Pod（preemptionPolicy 控制抢占行为）
