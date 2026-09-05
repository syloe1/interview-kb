### 反向代理位于客户端和后端服务器之间，负责转发请求并返回响应。它负责负载均衡、SSL 终止、缓存和请求路由。 
> 使用golang的 net/http/httputil 包中的 ReverseProxy 

## 基本反向代理
> 将所有流量转发到单个后端服务器。
```Go
package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
)

func main() {
	// 解析后端目标地址
	target, err := url.Parse("http://localhost:8080")
	if err != nil {
		log.Fatal(err)
	}
	// 创建单主机反向代理
	proxy := httputil.NewSingleHostReverseProxy(target)

	log.Println("Starting proxy server on:3000")
	// 启动标准库 http server，proxy 就是 http.Handler
	log.Fatal(http.ListenAndServe(":3000", proxy))
}

```
### 代理成功， 我们使用goroutine启动后端服务(8080)
````Go
package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

func backendHandler(w http.ResponseWriter, r *http.Request) {
	log.Printf("[后端8080] 收到请求: %s %s", r.Method, r.URL.Path)
	w.Write([]byte("后端服务(8080)路径:" + r.URL.Path))
}
func startBackend() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", backendHandler)
	log.Println("后端服务启动，监听 :8080")
	err := http.ListenAndServe(":8080", mux)
	if err != nil {
		log.Fatalf("backend listen err: %v", err)
	}
}
func main() {
	go startBackend()

	time.Sleep(300 * time.Millisecond)
	// 解析后端目标地址
	target, err := url.Parse("http://localhost:8080")
	if err != nil {
		log.Fatal(err)
	}
	// 创建单主机反向代理
	proxy := httputil.NewSingleHostReverseProxy(target)

	log.Println("Starting proxy server on : 3000")
	// 启动标准库 http server，proxy 就是 http.Handler
	log.Fatal(http.ListenAndServe(":3000", proxy))
}

````
## 增加自定义头部和日志请求细节：
```Go
package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

func backendHandler(w http.ResponseWriter, r *http.Request) {
	log.Printf("[后端8080] 收到请求: %s %s", r.Method, r.URL.Path)
	w.Write([]byte("后端服务(8080)路径:" + r.URL.Path))
}

func startBackend() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", backendHandler)
	log.Println("后端服务启动，监听 :8080")
	err := http.ListenAndServe(":8080", mux)
	if err != nil {
		log.Fatalf("backend listen err: %v", err)
	}
}
func main() {
	go startBackend()

	time.Sleep(300 * time.Millisecond)
	//解析后端目标地址
	target, _ := url.Parse("http://localhost:8080")
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host

			req.Header.Set("X-Proxy-Timestamp", time.Now().UTC().Format(time.RFC3339))

			if clientIP := req.RemoteAddr; clientIP != "" {
				req.Header.Set("X-Forwarded-For", clientIP)
			}
			log.Printf("Proxying: %s %s", req.Method, req.URL.Path)
		},
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Set("X-Response-From", "my-go-proxy")
			return nil
		},
	}

	log.Println("Starting proxy server on : 3000")
	// 启动标准库 http server，proxy 就是 http.Handler
	http.ListenAndServe(":3000", proxy)
}

```
## 手动创建一个带连接池，各种超时控制的http.Transport, 赋值给ReverseProxy.Transport
```GO
http.Transport 是**HTTP 下层（TCP 连接池、拨号、超时）**，属于底层网络控制，不会出现在 HTTP 报文里。
// 配置带连接池的 transport
	transport := &http.Transport{
		// 连接池相关配置
		MaxIdleConns:        100,              // 所有主机合计，最大空闲连接总数
		MaxIdleConnsPerHost: 20,               // 单个后端主机，最多保留的空闲长连接数量
		MaxConnsPerHost:     100,              // 单个后端主机的最大并发连接数（活跃连接+空闲连接）
		IdleConnTimeout:     90 * time.Second, // 空闲连接在连接池里的存活时长，超时自动关闭释放

		// TCP 建立连接阶段的超时配置
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second, // TCP拨号超时：30秒内TCP握手不成功则失败
			KeepAlive: 30 * time.Second, // TCP保活探测间隔：内核每30秒探测TCP连接是否存活
		}).DialContext,

		// TLS握手超时（HTTPS场景生效，HTTP下不生效）
		TLSHandshakeTimeout: 10 * time.Second,

		// 响应头超时：TCP连接建立成功后，等待后端返回响应头的最长时间
		ResponseHeaderTimeout: 10 * time.Second,
	}

```
## 多后端 负载均衡
```Go
package main

import (
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync/atomic"
	"time"
)

// Backend 后端节点结构体
type Backend struct {
	URL   *url.URL
	Alive bool
}

// LoadBalancer 负载均衡器
type LoadBalancer struct {
	backends []*Backend
	current  uint64 // 原子计数器，用来轮询
}

// NextBackend 获取下一个可用后端（轮询，跳过宕机节点）
func (lb *LoadBalancer) NextBackend() *Backend {
	next := atomic.AddUint64(&lb.current, 1)
	for i := 0; i < len(lb.backends); i++ {
		idx := (int(next) + i) % len(lb.backends)
		if lb.backends[idx].Alive {
			return lb.backends[idx]
		}
	}
	return nil // 没有可用后端
}

// backendHandler 后端业务处理函数，增加端口打印，方便区分到底是哪个后端响应
func backendHandler(port string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		log.Printf("[后端%s] 收到请求: %s %s", port, r.Method, r.URL.Path)
		// time.Sleep(11 * time.Second) // 测试超时的时候打开，平时注释
		w.Write([]byte("后端服务(" + port + ")路径:" + r.URL.Path))
	}
}

// startBackend 在指定端口启动一个后端服务
func startBackend(port string) {
	mux := http.NewServeMux()
	mux.HandleFunc("/", backendHandler(port))
	log.Printf("后端服务启动，监听 :%s", port)
	err := http.ListenAndServe(":"+port, mux)
	if err != nil {
		log.Fatalf("backend %s listen err: %v", port, err)
	}
}

func main() {
	// 定义3台后端地址
	backendURLs := []string{
		"http://localhost:8081",
		"http://localhost:8082",
		"http://localhost:8083",
	}

	// 初始化后端列表
	var backends []*Backend
	for _, u := range backendURLs {
		parsedURL, err := url.Parse(u)
		if err != nil {
			log.Fatalf("parse backend url err: %v", err)
		}
		backends = append(backends, &Backend{
			URL:   parsedURL,
			Alive: true,
		})
	}
	lb := &LoadBalancer{backends: backends}

	// 并发启动 3 个后端服务 8081,8082,8083
	go startBackend("8081")
	go startBackend("8082")
	go startBackend("8083")
	time.Sleep(500 * time.Millisecond) // 等待后端端口就绪

	// 配置带连接池的 transport
	transport := &http.Transport{
		// 连接池相关配置
		MaxIdleConns:        100,              // 所有主机合计，最大空闲连接总数
		MaxIdleConnsPerHost: 20,               // 单个后端主机，最多保留的空闲长连接数量
		MaxConnsPerHost:     100,              // 单个后端主机的最大并发连接数（活跃连接+空闲连接）
		IdleConnTimeout:     90 * time.Second, // 空闲连接在连接池里的存活时长，超时自动关闭释放
		// TCP 建立连接阶段的超时配置
		DialContext: (&net.Dialer{
			Timeout:   30 * time.Second, // TCP拨号超时：30秒内TCP握手不成功则失败
			KeepAlive: 30 * time.Second, // TCP保活探测间隔：内核每30秒探测TCP连接是否存活
		}).DialContext,
		// TLS握手超时（HTTPS场景生效，HTTP下不生效）
		TLSHandshakeTimeout: 10 * time.Second,
		// 响应头超时：TCP连接建立成功后，等待后端返回响应头的最长时间
		ResponseHeaderTimeout: 10 * time.Second,
	}

	proxy := &httputil.ReverseProxy{
		// ==========【重点修改Director】每次请求动态选择后端 ==========
		Director: func(req *http.Request) {
			backend := lb.NextBackend()
			if backend == nil {
				log.Println("没有可用后端")
				return
			}
			// 动态改写请求目标，替换成选中的后端地址
			req.URL.Scheme = backend.URL.Scheme
			req.URL.Host = backend.URL.Host
			req.Host = backend.URL.Host

			req.Header.Set("X-Proxy-Timestamp", time.Now().UTC().Format(time.RFC3339))
			if clientIP := req.RemoteAddr; clientIP != "" {
				req.Header.Set("X-Forwarded-For", clientIP)
			}
			log.Printf("Proxying: %s %s 转发至 %s", req.Method, req.URL.Path, backend.URL.String())
		},
		Transport: transport,
		ModifyResponse: func(resp *http.Response) error {
			// 添加安全响应头
			resp.Header.Set("X-Content-Type-Options", "nosniff")
			resp.Header.Set("X-Frame-Options", "DENY")
			resp.Header.Set("X-XSS-Protection", "1; mode=block")
			// 删除泄露后端信息的头
			resp.Header.Del("Server")
			resp.Header.Del("X-Powered-By")
			// 打印后端响应状态日志
			log.Printf("Backend responded: %d %s", resp.StatusCode, resp.Request.URL.Path)
			return nil
		},
	}

	log.Println("负载均衡代理启动 :3000")
	err := http.ListenAndServe(":3000", proxy)
	if err != nil {
		log.Fatalf("proxy listen err: %v", err)
	}
}

```
## 写个bash多跑两次curl
```Bash
#!/bin/bash
for ((i=0; i < 6; i++))
do
    curl http://127.0.0.1:3000/afd
    echo " - "
done

``` 