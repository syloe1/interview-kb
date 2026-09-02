### 部署一个应用

```bash
kubectl create deployment kuberneters-bootcamp --image=gcr.101
```

### 列出Deployment

```Bash
kubectl get deployments
```

### 查看代理

```Bash
kubectl proxy
```

### 检查应用配置

```Bash
kubectl describe pods
```

### 在容器上执行命令

```Bash
kubectl exec "$pod_name" --env
# 启动一个bsh会话
kubectl exec -ti $pod_name --bash
```

### 用service暴露应用

```Bash
NodePort使用NAT在每个Node
相同端口上公开service
kubectl expose deployment kubernetes-bootcamp --type ="NodePort" --port 8080
```

### 删除service

```Bash
kubectl delete service -l app=v1
```

### 看service

```Bash
kubectl describe services/kubernetes-bootcamp
#看标签
kubectl describe deployment

# 用标签查询
kubectl get pods -L app=kubernetes-bootcamp
#打标签
kubectl label pods "$POD_NAME" version = v1
```

### 扩缩应用

```Bash
kubectl expose deployment kubernetes-bootcamp --type="LoadBalancer" --port 8080
```

### 查看副本数量

```Bash
kubectl get rs
## 扩容
kubectl scale deployment kubernetes-bootcamps --replicas=4
## 检查
kubectl describe services
kubectl describe deployment
kubectl describe pods
#列出运行的Pods:
kubectl get pods
#滚动更新
kubectl set image deployments/kubernetes kubenertes-bootcamp=docker:v2
# 看进度
kubectl rollout status deployments/kubernetes-bootcamp

# 回滚
kubectl rollout undo deployments/kubernetes-bootcamp

# 查看版本历史
kubectl rollout history deployment/kubernetes-bootcamp
# 指定版本回滚
kubectl rollout undo deployment/kubernetes-bootcamp --to-reversion=2
```

## 滚动更新通过增量式更新Pod实现并替换新实例，允许Deployment更新过程中实现零停机
