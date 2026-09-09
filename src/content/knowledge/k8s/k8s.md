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

### 查看集群状态

- minikube status

### 查看k8s节点

- kubectl get nodes

### 打开minikube面板

- minikube get nodes

#### Pod是最小调度单元，是一组共生的容器，一个pod可以装一个或多个容器

#### Deployment是管理一组相同副本的Pod,负责pod的创建和扩缩容，版本发布

#### Service绑定Deployment的所有POd,提供统一稳定访问入口

```bash
Kubectl scale deployment 名字 --replicas=2 #修改数字即可扩容/缩容

#查看是否扩容成功
kubectl get pods
扩容replicaset
kubectl scale rs name --replicas=3
#扩容statefulset
kubectl scale sts name --replicas=3
```

````

#### 查看deployment

- kubectl get deployments

#### 查看集群事件

- kubectl get events

#### 查看kubectl配置

- kubectl config view

#### 查看POd应用程序日志

- kubectl get pods
- kubectl logs podname

#### 要让pod被kubernetes虚拟网络的外部访问，你必须将pod通过service公开出来

- kubectl expose deployment hello-node —type=LoadBalancer —port=8080
- service类型 负载均衡器

#### 查看你创建的Service

- kubectl get services

#### minikube service hello-node给minikube本地环境用，访问k8s服务

#### 查看端口 kubectl get svc

#### 列出当前支持的插件

- minikube addons list

#### 启用插件

- minikube addons enable metrics-server

#### 显示Kubernetes自己运行的所有后台组件

#### kubectl top pods查看Pod的CPU占用 + 内存占用

```bash
kubectl top pods = K8s版任务管理器，看pod耗不耗资源
````

#### 禁用

- minikube addons disable metrics-server

#### 清理资源

- kubectl delete service hello-node
- kubectl delete deployment hello-node

#### 停止minikube集群

- minikube stop

#### kubectl create deployment name部署应用

#### 查看Deployment

- kubectl get deployments

#### 启动一个本地代理

- kubectl proxy

### 使用service公开你的应用

ClusterIP 在集群的内部IP公开Service

```yaml
apiVersion: v1
kind: Service
spec:
	type: ClusterIP
	selector:
		app: nginx
	ports:
	- port: 80
```

NodePort 使用NAT在集群中每个选定Node的端口上公开Service

```yaml
# 节点IP + 端口从外部访问
type: NodePort
http://节点IP:30000~32767
```

LoadBalancer在当前云中创建一个负载均衡器

```yaml
type: LoadBalancer公有云用，自动分配公网IP
```

ExternalName将Service映射到extrnalName

### 标签和选择算符

```bash
"metadata": {
	"labels": {
		"key1" : "value1",
		"key2" : "value2"
	}
}

apiVersion: v1
kind: Pod
metadata:
	name: label-demo
	labels:
		environment: production
		app: nginx
spec:
	containers:
	- name: nginx
		image: nginx:1.14.2
		ports:
		- containerPort: 80
```

#### 使用describe deployment命令查看标签名称

- kubectl describe deployment

### 筛选带标签的Pod

- kubectl get pods -l app=kubernetes-bootcamp
- kubectl get service -l 标签=值

#### 给Pod打标签

kubectl label pods 名字 标签=值

#### 查看标签

- kubectl get pods —show-labels

#### rs是副本控制器，保证集群里一直运行着你指定数量的Pod

#### 查看完整版Pod信息

kubectl get pods -o wide

### 一个简单的pod.yaml

```yaml
apiVersion: v1
kind: Pod
metadata:
 name: my-pod
spec:
	containers:
	- name: nginx
		image: nginx:alpine
```

- kubectl apply -f yaml创建
- kubectl delete -f yaml删除

#### deployment是Pod的管理员

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
	name: my-deploy
spec:
	replicas: 3 #3个副本
	selector:
		matchLabels:
			app: nginx
	template:
		metadata:
			labels:
				app:nginx
		spec:
			containers:
			- name: nginx
				image: nginx:alpine
```

#### Service给一组pOd提供固定IP和负载均衡

#### Ingress外部访问入口，把集群外的HTTP/HTTPS流量导入Service

ConfigMap/Secret配置外挂不写死镜像

#### Namespace是k8s文件夹，用来隔离

### k8s常用命令

```yaml

# 查看资源
kubectl get pods
kubectl get deployments
kubectl get svc
kubectl get ingress
kubectl get cm
kubectl get ns
kubectl get all  # 看所有

# 查看详情
kubectl describe pod <pod名>
kubectl describe svc <svc名>

# 日志
kubectl logs <pod名>
kubectl logs -f <pod名>  # 实时日志

# 进入容器
kubectl exec -it <pod名> -- sh

# 删除
kubectl delete pod <pod名>
kubectl delete -f xxx.yaml
```

### yaml四件套

```yaml
apiVersion: # 版本
kind: # 资源类型
metadata: # 名字、标签
spec: # 规格内容
```

### kubectl create deploy my-nginx --image=nginx -o yaml --dry-run=client > my.yaml

### 排错3大利器

```yaml
# 1. 看事件（找为什么起不来）
kubectl get events
kubectl describe pod xxx

# 2. 看日志
kubectl logs xxx

# 3. 进入容器检查
kubectl exec -it xxx -- sh
```

#### 滚动更新不停机升级

```yaml
kubectl set image deployment/deployment名称 nginx=nginx:1.25
后面的nginx=nginx:1.25是容器名称:新镜像地址+版本
```

### 查看Deployment的更新历史

- kubectl rollout history deployment my-deploy

### 回滚上一个版本

- kubectl rollout undo deployment my-deploy

### HPA自动扩缩容， 让Deployment根据CPU使用率自动增加/减少Pod数量

kubectl autoscale deployment my-deploy —min=2 —max=5 —cpu-percent=7

**CPU 平均使用率达到 70%** 时，自动增加 Pod

### 存储， 卷挂载

#### 临时卷 emptyDir

- Pod删除数据就丢

```yaml
volumes:
- name: cache
	emptyDir: {}
```

- ConfigMap挂载（配置文件）

```yaml
volumes:
- name: config
	configMap:
		name: my-config
```

PV/PVC持久存储：

PV集群的硬盘

PVC: Pod申请硬盘

```yaml
volumes:
- name: data
	persistentVolumeClaim:
		claimName: my-pvc
```

# CRD自定义资源： 给kubernetes扩展你自己的API对象

Reconcile Loop调谐循环， Operator的核心逻辑吗让集群始终符合你期望的状态

### Operator = CRD + 控制器 = Kubernetes方式管理有状态的应用

K8s自带Pod, Service, Deployment, StatefulSet. 用CRD可以创建MyDatabase, Myredis,Myapp, MyCluster. CR自定义资源实例

## CRD核心结构：

group: API分组

names: 资源名称

scope: Namespaced/Cluster

version: 版本 + OPENAPI校验schema

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: myapps.app.example.com
spec:
  group: app.example.com
  names:
    kind: MyApp
    listKind: MyAppList
    plural: myapps
    singular: myapp
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                image:
                  type: string
                replicas:
                  type: integer
                port:
                  type: integer
```

**1. 什么是 Reconcile Loop？**

无限循环 + 监听资源变化 + 让实际状态 = 期望状态

```yaml
while True:
    获取 CR 的【期望状态】(spec)
    获取集群的【实际状态】(status)
    if 实际状态 != 期望状态:
        执行操作（创建Pod/Service/Deployment...）
    else:
        什么都不做（等待下一次触发）
```

## 触发 Reconcile 的时机**事件触发**：

- CR 创建 / 更新 / 删除
- CR 关联的 Pod / Service / Deployment 变化
- 定时重新同步（默认 10 小时）
- 手动排队重试

### Reconcile 核心设计思想

- **幂等性**：执行多少次结果都一样（非常重要！）
- **不报错就不重试，报错就自动重试**
- **只负责 “调谐”，不负责 “一次性任务”**
- **最终一致性**：不追求立刻一致，保证最终一致

```yaml
用户创建 CR → 存入 etcd
↓
Operator 监听 CR 变化
↓
进入 Reconcile Loop
↓

1. 读取 CR.Spec（期望状态）
2. 读取当前集群状态
3. 对比差异
4. 执行创建/更新/删除
5. 更新 CR.Status（反馈状态）
↓
循环持续，永远保持一致
```

## spec你想要的状态 status实际状态

- 命令式：`我要你现在创建Pod`
- 声明式：`我想要2个Pod` → Operator 保证永远是 2 个

Operator 本质就是 **自定义控制器**。

Operator 不保证立刻生效，但保证**最终一定生效**。
Reconcile 执行 1 次 = 执行 100 次
让创建的资源（Pod/Deployment）**属于 CR**CR 删除 → 子资源自动删除（垃圾回收）

- 这是 **K8s Operator 标准 Reconcile 函数**，负责自动管理资源
- 五大步骤：**获取 CR → 构建期望资源 → 创建 → 更新 → 同步状态**
- 核心能力：**自愈、自动扩缩容、配置同步**
- 生产环境只需补充**所有者引用、Patch 更新、删除逻辑**即可

## 查看集群内网地址

minikube ip

```yaml
停止
minikube stop
重启
minikube restart
彻底重置
minikube delete && minikube start
```

## cmd/scheduler

```go
一个带全部社区调度插件的 自定义 K8s 调度器
所有插件（coscheduling、qos、noderesources、拓扑调度、负载均衡调度等）全部注册
```

#### cmd/scheduler = 增强版 kube-scheduler，内置几十种高级调度插件

# cmd/controller调度插件专属后台控制器

```go
监听两个自定义 CRD：
PodGroup （给 协同调度 coscheduling 用）
ElasticQuota （给 容量调度 / 配额调度 用）
cmd/controller = 给高级调度插件打工的后台控制器进程
```

## 调度解决方案

由 **调度器进程 + 控制器进程** 双组件组成：

1. 调度器：负责实时 Pod 调度、过滤、打分、排队
2. 控制器：负责后台 CRD 管理、PodGroup / 配额调谐、全局状态维护两者搭配，才能跑起来 coscheduling、capacityscheduling 这类复杂高级调度能力。
