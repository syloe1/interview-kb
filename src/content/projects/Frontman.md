## Frontman
> 网关 = 反向代理 + 路由 + 策略执行
-  1. 接收请求 2. 执行插件PreRequest 3.路由匹配 ，找后端服务
-  4. 负载均衡 5. 路径处理 6. 认证鉴权 7. 转发请求到上游
-  8. 执行插件PostResponse 9. 把响应原样返回给客户端

## frontman/cmd/frontman/main.go
> 负责命令行解析， 配置加载， 日志初始化，组装网关对象， 最后启动HTTP网关服务
```shell
./frontman -config ./frontman.yaml -log-level debug
```
- 解析flag参数， config.LoadConfig()加载yaml配置文件
- 解析日志级别， 初始化日志， frontman.NewFrontman(config, logger)创建网关实例
- gateway.Start() 阻塞启动HTTP网关服务
```Go
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/Frontman-Labs/frontman"        //网关
	"github.com/Frontman-Labs/frontman/config" //配置
	"github.com/Frontman-Labs/frontman/log"    //日志
)

func main() {

	// Define command-line flags
	var configFile string
	var logLevel string
	/*
		- `flag.StringVar(变量指针, 参数名, 默认值, 帮助说明)`
		- `-config`：指定 yaml 配置文件路径；不传则是空字符串
		- `-log-level`：命令行设置日志等级，支持 debug/info/warn/error
		Usage : ./frontman -config ./etc/frontman.yaml -log-level debug
	*/
	flag.StringVar(&configFile, "config", "", "path to configuration file")
	flag.StringVar(&logLevel, "log-level", "", "set log level to debug")

	// Parse command-line flags
	flag.Parse()

	// Load configuration from file or use default
	configPath := configFile
	if configPath == "" {
		configPath = "frontman.yaml"
	}

	config, err := config.LoadConfig(configPath)
	if err != nil {
		fmt.Printf("failed to load configuration: %v", err)
		os.Exit(1)
	}

	// 优先级：命令行参数 > yaml配置 > 默认info
	if logLevel == "" {
		// 命令行没有指定，读取配置文件
		logLevel = config.LoggingConfig.Level
		// 如果配置文件也为空，回退info
		if logLevel == "" {
			logLevel = "info"
		}
	}

	//log.ParseLevel() 字符串 ("debug"/"info") 转内部日志等级枚举
	logger, err := log.NewDefaultLogger(log.ParseLevel(logLevel))
	if err != nil {
		fmt.Println("failed to initialize logger")
		os.Exit(1)
	}

	// Create a new Gateway instance
	gateway, err := frontman.NewFrontman(config, logger)
	if err != nil {
		logger.Fatalf("failed to create gateway: %v", err)
	}

	// Start the server
	logger.Fatal(gateway.Start())
}

```

## frontman/frontman.go
> 网关顶层对象定义， 组装注册中心， 插件， 管理API, 业务网关， 启动两套独立HTTP服务
>
> - 管理API服务， 默认  `0.0.0.0:8080`， 提供http接口动态管理后端服务
- 业务网关代理服务， 默认 `0.0.0.0:8080`, 处理业务流量反向代理转发
|字段|作用|
|----|----|
|router|*gateway.APIGateway，业务网关核心处理器，处理用户业务请求|
|service|*httprouter.Router，管理API路由，提供网关动态管理接口|
|backendServices|service.ServiceRegistry，后端服务注册中心，维护上游服务列表|
|conf|*config.Config，全局配置对象|
|log|log.Logger，日志实例|

###  NewFrontman(conf, log) *Frontman, error
执行流程：
1. 创建`serviceRegistry`服务注册中心，支持静态配置/redis动态注册
2. 构建管理API路由 `api.NewServicesRouter(serviceRegistry)`
3. 如果插件开启，加载插件列表
4. 初始化核心业务网关 `gateway.NewAPIGateway()`，注入注册中心、插件
5. 组装Frontman结构体返回
```Go
type Frontman struct {
	router          *gateway.APIGateway     //业务网关：处理业务流量，反向代理
	service         *httprouter.Router      //管理API路由，提供http管理接口
	backendServices service.ServiceRegistry //后端服务注册中心
	conf            *config.Config          //全局配置
	log             log.Logger              //日志实例
}

// NewFrontman creates a new Frontman instance with a Redis client connection factory
func NewFrontman(conf *config.Config, log log.Logger) (*Frontman, error) {
	ctx := context.Background()

	// Create a new serviceRegistry instance
	serviceRegistry, err := service.NewServiceRegistry(ctx, conf.GlobalConfig.ServiceType, conf)
	if err != nil {
		return nil, err
	}

	// Create management API router
	servicesRouter := api.NewServicesRouter(serviceRegistry)

	// Load plugins
	var plug []plugins.FrontmanPlugin

	if conf.PluginConfig.Enabled {
		plug, err = plugins.LoadPlugins(conf.PluginConfig.Order)
		if err != nil {
			return nil, err
		}

	}

	// Create new APIGateway instance
	apiGateway := gateway.NewAPIGateway(serviceRegistry, plug, conf, log)

	// Create the Frontman instance
	return &Frontman{
		router:          apiGateway,
		service:         servicesRouter,
		backendServices: serviceRegistry,
		conf:            conf,
		log:             log,
	}, nil
}
`
```

### Start() error
> 同时启动多套http服务：管理API、业务网关；网关开启SSL额外启动80端口http‑>https重定向服务。
1. 读取监听地址，设置默认端口
2. 加载管理API TLS证书，构建`http.Server`；**goroutine异步启动管理API，不阻塞主线程**
3. 加载业务网关TLS证书；网关SSL开启时，额外goroutine启动80端口301重定向服务
4. **业务网关服务在主协程阻塞运行**，程序卡在这；网关服务异常返回error，上层触发进程退出。
```Go

func (gw *Frontman) Start() error {
	apiAddr := gw.conf.APIConfig.Addr
	if apiAddr == "" {
		apiAddr = "0.0.0.0:8080" //管理API默认端口
	}
	gatewayAddr := gw.conf.GatewayConfig.Addr
	if gatewayAddr == "" {
		gatewayAddr = "0.0.0.0:8000" //业务网关默认端口
	}

	var apiHandler http.Handler
	var gatewayHandler http.Handler

	apiHandler = gw.service      //管理API的Handlder是httprouter
	var apicert *tls.Certificate // 如果启用了TLS，加载证书
	if gw.conf.APIConfig.SSL.Enabled {
		cert, err := ssl.LoadCert(gw.conf.APIConfig.SSL.Cert, gw.conf.APIConfig.SSL.Key)
		if err != nil {
			return err
		}
		apicert = cert
	}
	apiHandler = gw.service
	api := createServer(apiAddr, apiHandler, apicert)
	//管理Api服务器放到goroutine异步启动， 不阻塞主线程
	go func() {
		if err := startServer(api); err != nil {
			gw.log.Fatal(err)
		}
	}()
	gw.log.WithFields(log.InfoLevel, fmt.Sprintf("Started Frontman API on %s", apiAddr), log.Bool("tls_enabled", gw.conf.APIConfig.SSL.Enabled))
	//启动业务网关服务
	var gwcert *tls.Certificate
	gatewayHandler = gw.router //业务网关handler是APIGateway
	// 如果启用了TLS，加载证书
	if gw.conf.GatewayConfig.SSL.Enabled {
		cert, err := ssl.LoadCert(gw.conf.GatewayConfig.SSL.Cert, gw.conf.GatewayConfig.SSL.Key)
		if err != nil {
			return err
		}
		gwcert = cert
		// 额外启动一个HTTP 80端口服务， Redirect HTTP traffic to HTTPS
		httpAddr := "0.0.0.0:80"
		httpRedirect := createRedirectServer(httpAddr, gatewayAddr)
		gw.log.Infof("Started HTTP redirect server on %s", httpAddr)
		go func() {
			if err := startServer(httpRedirect); err != nil {
				gw.log.Fatal(err)
			}
		}()
	}
	gatewayHandler = gw.router
	gateway := createServer(gatewayAddr, gatewayHandler, gwcert)
	gw.log.WithFields(log.InfoLevel, fmt.Sprintf("Started Frontman Frontman on %s", gatewayAddr), log.Bool("tls_enabled", gw.conf.GatewayConfig.SSL.Enabled))
	if err := startServer(gateway); err != nil {
		return err
	}

	return nil
}
```

### 内部函数
- 1. `createRedirectServer(addr,redirectAddr)`：创建http 301永久重定向服务，http跳转https
- 2. `createServer(addr,handler,cert)`：封装构建`*http.Server`对象，传入证书开启TLS
- 3. `startServer(server)`：判断TLS配置，调用`ListenAndServeTLS`/`ListenAndServe`，`%w`包装错误，保留错误链。

```Go

// http  80端口全部跳转到https, 状态码301永久重定向
func createRedirectServer(addr string, redirectAddr string) *http.Server {
	redirect := func(w http.ResponseWriter, req *http.Request) {
		httpsURL := "https://" + req.Host + req.URL.Path
		http.Redirect(w, req, httpsURL, http.StatusMovedPermanently)
	}
	return &http.Server{
		Addr:    addr,
		Handler: http.HandlerFunc(redirect),
	}
}

// 封装创建http.Server,支持TLS, 没证书就是普通http
func createServer(addr string, handler http.Handler, cert *tls.Certificate) *http.Server {
	server := &http.Server{
		Addr:    addr,
		Handler: handler,
	}
	if cert != nil {
		server.TLSConfig = &tls.Config{
			Certificates: []tls.Certificate{*cert},
		}
	}
	return server
}

func startServer(server *http.Server) error {
	if server.TLSConfig != nil {
		if err := server.ListenAndServeTLS("", ""); err != nil {
			return fmt.Errorf("Failed to start server with TLS: %w", err)
		}
	} else {
		if err := server.ListenAndServe(); err != nil {
			return fmt.Errorf("Failed to start server without TLS: %w", err)
		}
	}
	return nil
}

```
## frontman/config/config.go
> 整个网关全部Yaml配置结构体，实现LoadConfig()加载配置文件， 支持yaml文件 + 环境变量覆盖配置
> 环境变量 > yaml配置
>  注意：当前仅SSL相关字段支持环境变量覆盖，其余配置项不读环境变量。
```Go
package config

import (
	"os"

	"gopkg.in/yaml.v3"
)

// GlobalConfig holds the global application configuration
// GlobalConfig holds the global configuration

type GlobalConfig struct {
	ServiceType         string `yaml:"service_type"`    //后端服务来源类型：file / redis / mongo
	ServicesFile        string `yaml:"services_file"`   //静态服务配置文件路径
	RedisURI            string `yaml:"redis_uri"`       //redis连接地址
	RedisNamespace      string `yaml:"redis_namespace"` //redis key前缀命名空间
	MongoURI            string `yaml:"mongo_uri"`       //mongo连接地址
	MongoDatabaseName   string `yaml:"mongo_db_name"`
	MongoCollectionName string `yaml:"mongo_collection_name"`
}

// SSLConfig holds the SSL configuration
type SSLConfig struct {
	Enabled bool   `yaml:"enabled"` //是否开启tls
	Cert    string `yaml:"cert"`    //证书文件路径
	Key     string `yaml:"key"`     //私钥文件路径
}

type JWTConfig struct {
	Audience string `json:"audience" yaml:"audience"`
	Issuer   string `json:"issuer" yaml:"issuer"`
	KeysUrl  string `json:"keysUrl" yaml:"keysUrl"` //JWKS公钥地址
}

type BasicAuthConfig struct {
	Username        string `json:"username" yaml:"username"`
	Password        string `json:"password" yaml:"password"`
	UsernameEnv     string `json:"usernameEnvVariable" yaml:"usernameEnvVariable"` //读取环境变量作为用户名
	PasswordEnv     string `json:"passwordEnvVariable" yaml:"passwordEnvVariable"`
	CredentialsFile string `json:"credentialsFile" yaml:"credentialsFile"` //凭证文件
}

// Auth config
type AuthConfig struct {
	AuthType        string           `json:"type" yaml:"type"`                     //认证类型: none / jwt / basic
	UserDataHeader  string           `json:"userDataHeader" yaml:"userDataHeader"` //解析后用户信息放入哪个http header
	JWT             *JWTConfig       `json:"jwt" yaml:"jwt"`
	BasicAuthConfig *BasicAuthConfig `json:"basic" yaml:"basic"`
}

// APIConfig holds the API server configuration
type APIConfig struct {
	Addr string    `yaml:"addr"`
	SSL  SSLConfig `yaml:"ssl"`
}

// GatewayConfig holds the gateway server configuration
type GatewayConfig struct {
	Addr string    `yaml:"addr"`
	SSL  SSLConfig `yaml:"ssl"`
}

// LoggingConfig holds the logging configuration
type LoggingConfig struct {
	Level string `yaml:"level"`
}

// PluginConfig holds the plugin configuration
type PluginConfig struct {
	Enabled bool     `yaml:"enabled"`
	Order   []string `yaml:"order"`
}

// Config holds the complete application configuration
type Config struct {
	GlobalConfig  GlobalConfig  `yaml:"global"`
	APIConfig     APIConfig     `yaml:"api"`
	GatewayConfig GatewayConfig `yaml:"gateway"`
	LoggingConfig LoggingConfig `yaml:"logging"`
	PluginConfig  PluginConfig  `yaml:"plugins"`
}

// LoadConfig loads the application configuration from a YAML file and environment variables
func LoadConfig(filename string) (*Config, error) {
	// Load the YAML configuration file
	data, err := os.ReadFile(filename)
	if err != nil {
		return nil, err
	}
	config := &Config{}
	err = yaml.Unmarshal(data, config)
	if err != nil {
		return nil, err
	}

	// Check if SSL is enabled for the API server
	if apiSSL := os.Getenv("API_SSL_ENABLED"); apiSSL != "" {
		config.APIConfig.SSL.Enabled = apiSSL == "true"
	}
	if config.APIConfig.SSL.Enabled {
		if certPath := os.Getenv("API_SSL_CERT"); certPath != "" {
			config.APIConfig.SSL.Cert = certPath
		}
		if keyPath := os.Getenv("API_SSL_KEY"); keyPath != "" {
			config.APIConfig.SSL.Key = keyPath
		}
	}

	// Check if SSL is enabled for the Gateway server
	if gatewaySSL := os.Getenv("GATEWAY_SSL_ENABLED"); gatewaySSL != "" {
		config.GatewayConfig.SSL.Enabled = gatewaySSL == "true"
	}
	if config.GatewayConfig.SSL.Enabled {
		if certPath := os.Getenv("GATEWAY_SSL_CERT"); certPath != "" {
			config.GatewayConfig.SSL.Cert = certPath
		}
		if keyPath := os.Getenv("GATEWAY_SSL_KEY"); keyPath != "" {
			config.GatewayConfig.SSL.Key = keyPath
		}
	}

	return config, nil
}

```
## gateway/gateway.go
> APIGateway结构体实现了http.Handler接口 (serveHTTP)
> 业务网关流量全部进入这个函数
> 所有 反向代理， 路由匹配， 负载均衡， 路径重写，插件拦截，鉴权，请求转发，响应回写全部在这里完成。
```Go
package gateway

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/Frontman-Labs/frontman/config"
	"github.com/Frontman-Labs/frontman/log"
	"github.com/Frontman-Labs/frontman/plugins"
	"github.com/Frontman-Labs/frontman/service"
)

type APIGateway struct {
	reg   service.ServiceRegistry  // 后端服务注册中心（所有后端服务列表）
	plugs []plugins.FrontmanPlugin // 插件列表（限流、跨域、鉴权等）
	conf  *config.Config           // 全局配置
	log   log.Logger               // 日志
}

func NewAPIGateway(bs service.ServiceRegistry, plugs []plugins.FrontmanPlugin, conf *config.Config, logger log.Logger) *APIGateway {
	return &APIGateway{
		reg:   bs,
		plugs: plugs,
		conf:  conf,
		log:   logger,
	}
}

func (g *APIGateway) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	//前置插件执行
	for _, plugin := range g.plugs {
		if err := plugin.PreRequest(req, g.reg, g.conf); err != nil {
			g.log.Errorf("Plugin error: %v", err)
			http.Error(w, err.Error(), err.StatusCode())
			return
		}
	}

	// Find the backend service that matches the request
	// 路由匹配
	backendService := g.reg.GetTrie().FindBackendService(req)

	// If the backend service was not found, return a 404 error
	if backendService == nil {
		http.NotFound(w, req)
		return
	}

	// Get the upstream target URL for this request
	// 负载均衡
	upstreamTarget := backendService.GetLoadBalancer().ChooseTarget(backendService.UpstreamTargets)

	urlPath := req.URL.Path
	if backendService.StripPath {
		urlPath = strings.TrimPrefix(req.URL.Path, backendService.Path)
	}

	// Use the compiledRewriteMatch field in the backendService struct to apply the rewrite
	//路径重写
	if backendService.GetCompiledRewriteMatch() != nil {
		urlPath = backendService.GetCompiledRewriteMatch().ReplaceAllString(urlPath, backendService.RewriteReplace)
	}

	// Create a new target URL with the service path and scheme
	targetURL, err := url.Parse(upstreamTarget + urlPath)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Add query parameters if they are available
	if req.URL.RawQuery != "" {
		targetURL.RawQuery = req.URL.RawQuery
	}

	// Get client for backend service
	//每个服务独立HTTP Client
	//每个后端服务拥有独立HTTP连接池
	client := backendService.GetHttpClient()

	// Copy the headers from the original request
	headers := make(http.Header)
	copyHeaders(headers, req.Header)
	//鉴权模块
	if backendService.AuthConfig != nil {
		tokenValidator := backendService.GetTokenValidator()
		// Backend service has auth config specified
		claims, err := tokenValidator.ValidateToken(req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		if claims != nil {
			data, err := json.Marshal(claims)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			headers.Add(backendService.GetUserDataHeader(), string(data))
		}

	}
	// Remove the X-Forwarded-For header to prevent spoofing
	headers.Del("X-Forwarded-For")

	// Log a message indicating that the request is being sent to the target service
	g.log.Infof("Sending request to %s: %s %s", upstreamTarget, req.Method, urlPath)

	// Send the request to the target service using the client with the specified transport
	//反向代理
	resp, err := client.Do(&http.Request{
		Method:        req.Method,
		URL:           targetURL,
		Proto:         req.Proto,
		ProtoMajor:    req.ProtoMajor,
		ProtoMinor:    req.ProtoMinor,
		Header:        headers,
		Body:          req.Body,
		ContentLength: req.ContentLength,
		Host:          targetURL.Host,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		g.log.Infof("Error sending request: %v\n", err.Error())
		return
	}
	//负载均衡健康度更新
	backendService.GetLoadBalancer().Done(upstreamTarget)

	defer resp.Body.Close()

	for _, plugin := range g.plugs {
		if err := plugin.PostResponse(resp, g.reg, g.conf); err != nil {
			g.log.Infof("Plugin error: %v", err)
			http.Error(w, err.Error(), err.StatusCode())
			return
		}
	}

	// Log a message indicating that the response has been received from the target service
	g.log.Infof("Response received from %s: %d %s", upstreamTarget, resp.StatusCode, resp.Status)

	// Copy the response headers back to the client
	//响应回写
	copyHeaders(w.Header(), resp.Header)

	// Set the status code and body of the response
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)

}

func copyHeaders(dst, src http.Header) {
	for k, v := range src {
		dst[k] = v
	}
}

```
## frontman/service/errors.go
> 服务注册模块，专门自定义业务错误
> 系统级错误用原生error, 业务级错误自定义结构体实现error接口
> 只要实现Error() string, 就是error类型
> 服务已存在， 服务不存在， 服务不支持
```Go
package service

import "fmt"

type ErrServiceExists struct {
	Name string
}

func (e ErrServiceExists) Error() string {
	return fmt.Sprintf("service with name '%s' already exists", e.Name)
}

type ErrServiceNotFound struct {
	Name string
}

func (e ErrServiceNotFound) Error() string {
	return fmt.Sprintf("service with name '%s' not found", e.Name)
}

type ErrUnsupportedServiceType struct {
	serviceType string
}

func (e ErrUnsupportedServiceType) Error() string {
	return fmt.Sprintf("unsupported service type: %s", e.serviceType)
}

```
## frontman/service/registry.go
> 服务注册中心 + 基础实现
> 根据配置service_type自动切换四种存储后端yaml, redis, mongo, memory
> 先备份快照， 内存修改， 子类持久化， 持久化失败， 内存回滚
```Go
package service

import (
	"context"
	"sync"

	"github.com/Frontman-Labs/frontman/config"
)

// ServiceRegistry holds the methods to interact with the backend service registry
type ServiceRegistry interface {
	AddService(service *BackendService) error
	UpdateService(service *BackendService) error
	RemoveService(name string) error
	GetServices() []*BackendService
	GetTrie() *RoutingTrie //获取路由树
}

type baseRegistry struct {
	mutex       *sync.RWMutex     // 读写锁，保证并发安全
	services    []*BackendService // 内存中维护的所有后端服务列表
	routingTrie *RoutingTrie      // 网关路由基数树
}

func NewServiceRegistry(ctx context.Context, serviceType string, config *config.Config) (ServiceRegistry, error) {
	var (
		reg ServiceRegistry
		mu  sync.RWMutex
		err error
	)
	//基础注册器
	baseReg := baseRegistry{
		mutex: &mu,
		routingTrie: &RoutingTrie{
			mutex: &mu,
		},
	}

	switch serviceType {
	//redis, mongo是外部独立服务， 需要网络客户端连接
	//yaml, memory不需要外部服务，没有网络客户端对象
	case "redis":
		redisClient, err := NewRedisClient(ctx, config.GlobalConfig.RedisURI)
		if err != nil {
			return nil, err
		}
		reg, err = NewRedisRegistry(ctx, redisClient, config.GlobalConfig.RedisNamespace, &baseReg)
		if err != nil {
			return nil, err
		}
	case "mongo":
		mongoClient, err := NewMongoClient(ctx, config.GlobalConfig.MongoURI)
		if err != nil {
			return nil, err
		}
		reg, err = NewMongoServiceRegistry(ctx, mongoClient, config.GlobalConfig.MongoDatabaseName, config.GlobalConfig.MongoCollectionName, &baseReg)
		if err != nil {
			return nil, err
		}
	case "yaml":
		reg, err = NewYAMLServiceRegistry(config.GlobalConfig.ServicesFile, &baseReg)
		if err != nil {
			return nil, err
		}
	case "memory": // For testing
		reg = NewMemoryServiceRegistry(&baseReg)
	default:
		return nil, ErrUnsupportedServiceType{serviceType: serviceType}
	}

	// Initialise routing trie
	baseReg.routingTrie.BuildRoutes(reg.GetServices())

	return reg, nil
}

func (r *baseRegistry) getServices() []*BackendService {
	services := make([]*BackendService, len(r.services))
	copy(services, r.services)
	return services
}

func (r *baseRegistry) addService(service *BackendService, apply func() error) error {
	old := r.getServices() //备份快照

	for _, s := range r.services {
		if s.Name == service.Name {
			return ErrServiceExists{Name: service.Name}
		}
	}

	r.services = append(r.services, service)
	err := apply() //执行子类持久化
	if err != nil {
		r.services = old //回滚
		return err
	}

	r.routingTrie.BuildRoutes(r.services) //重建路由树

	return nil
}

func (r *baseRegistry) updateService(service *BackendService, apply func() error) error {
	old := r.getServices()

	for i, s := range r.services {
		if s.Name == service.Name {
			r.services[i] = service
			err := apply()
			if err != nil {
				r.services = old
				return err
			}

			r.routingTrie.BuildRoutes(r.services)
			return nil
		}
	}

	return ErrServiceNotFound{Name: service.Name}
}

func (r *baseRegistry) removeService(name string, apply func() error) error {
	old := r.getServices()

	for i, s := range r.services {
		if s.Name == name {
			r.services = append(r.services[:i], r.services[i+1:]...)
			err := apply()
			if err != nil {
				r.services = old
				return err
			}

			r.routingTrie.BuildRoutes(r.services)
			return nil
		}
	}

	return ErrServiceNotFound{Name: name}
}

func (r *baseRegistry) GetTrie() *RoutingTrie {
	return r.routingTrie
}

```
## frontman/service/routing_trie.go
> 网关 路由字典树， 用于 业务代理流量的路由匹配
> 业务代理请求使用自研Trie, 支持运行时动态增删路由，支持 域名 + URL路径前缀路由
> APIGateway.ServeHTTP -> FindBackendService() 获取后端服务
```Go
package service

import (
	"net/http"
	"strings"
	"sync"
)

type RoutingTrie struct {
	mutex *sync.RWMutex // 读写锁：读多写少，查询RLock；构建树写锁（BuildRoutes）
	root  *Route        // trie树根节点
}

type Route struct {
	label    string            // 当前节点标识：域名 / url路径片段
	isEnd    bool              // 是否一条路由规则的结束节点
	service  *BackendService   // 该节点绑定的后端服务，只有有效路由节点才不为nil
	children map[string]*Route // 子节点map，key：下一段片段
}

func (rt *RoutingTrie) BuildRoutes(services []*BackendService) {
	rt.root = &Route{
		label:    "",
		children: make(map[string]*Route),
	}

	for _, s := range services {
		rt.insertNode(s)
	}
}

func (rt *RoutingTrie) FindBackendService(r *http.Request) *BackendService {
	//读锁， 大量请求并发查询， Rlock共享读，不阻塞其他读
	rt.mutex.RLock()
	defer rt.mutex.RUnlock()

	node := rt.root
	pathSegments := strings.Split(r.URL.Path, "/")
	// 剥离Host端口：Host是 "test.com:8080" → domain = "test.com"
	domain := strings.Split(r.Host, ":")[0]

	// Check for domain-based routing first
	// 优先域名路由匹配
	domainNode, ok := node.children[domain]
	if ok {
		//域名节点本身就挂载了service,直接返回
		if domainNode.service != nil {
			return domainNode.service
		}
		node = domainNode
	}

	// Check for path-based routing
	//路径片段循环匹配
	for i, segment := range pathSegments {
		if segment == "" {
			continue
		}

		child, ok := node.children[segment]
		if !ok {
			return node.service
		}
		//子节点有service,并且service的域名和请求域名一致
		if child.service != nil && child.service.Domain == domain {
			//完全匹配，直接返回服务
			if i == len(pathSegments)-1 {
				return child.service
			}
			node = child
			continue
		}
		//子节点给service, service不带域名
		if child.service != nil && child.service.Domain == "" {
			node = child
			continue
		}

		node = child
	}

	return node.service
}

func (rt *RoutingTrie) insertNode(service *BackendService) {
	node := rt.root
	// Handle domain-based routing first
	// 处理路由
	if service.Domain != "" {
		domainNode, ok := node.children[service.Domain]
		if !ok {
			//新建域名节点
			domainNode = &Route{
				label:    service.Domain,
				children: make(map[string]*Route),
			}
			node.children[service.Domain] = domainNode
		}
		node = domainNode
	}
	//拆分路径， 逐层创建路径节点
	segments := strings.Split(service.Path, "/")
	// 例 Path="/api/user" → Split后得到：["", "api", "user"]
	for _, s := range segments {
		if s == "" {
			continue
		}
		// 看当前节点子节点有没有这个路径片段
		child, ok := node.children[s]
		if !ok {
			// 没有就新建Route节点
			child = &Route{
				label:    s,
				children: make(map[string]*Route),
			}
			node.children[s] = child
		}
		node = child
	}

	node.isEnd = true //标记，这是一条路由规则的结尾
	node.service = service
}

```
## frontman/service/backend.go 
> 后端服务模型BackendService， 流量转发，负载均衡， 鉴权， 路径重写， 连接池， 健康检测的实体
> 网关每一条路由对应的后端服务，就是一个Backend Service对象
- 加载yaml ->构造BackendService对象 -> 调用Init() 初始化鉴权器， 负载均衡实例， 创建http连接池， 预编译重写正则
-  存入Trie路由树
-  到达网关 -> 路由匹配，拿到BackendService
```Go
package service

import (
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/Frontman-Labs/frontman/auth"
	"github.com/Frontman-Labs/frontman/config"
	"github.com/Frontman-Labs/frontman/loadbalancer"
	"github.com/Frontman-Labs/frontman/oauth"
)

// BackendService holds the details of a backend service
type BackendService struct {
	Name               string             // 服务唯一名称
	Scheme             string             // 协议 http / https
	UpstreamTargets    []string           // 后端节点列表 [127.0.0.1:8080, ...]
	Path               string             // 网关匹配路径
	Domain             string             // 域名匹配（虚拟主机）
	HealthCheck        string             // 健康检查接口地址
	RetryAttempts      int                // 重试次数
	Timeout            time.Duration      // 超时时间
	MaxIdleConns       int                // 最大空闲连接数
	MaxIdleTime        time.Duration      // 连接最大空闲时间
	StripPath          bool               // 是否截断网关前缀路径
	AuthConfig         *config.AuthConfig // 单服务独立鉴权配置
	LoadBalancerPolicy LoadBalancerPolicy // 负载均衡策略
	RewriteMatch       string             // 路径重写正则
	RewriteReplace     string             // 路径重写替换内容

	//内部私有运行时字段
	httpClient           *http.Client              // 当前服务独立连接池客户端
	compiledRewriteMatch *regexp.Regexp            // 预编译正则（性能优化）
	loadBalancer         loadbalancer.LoadBalancer // 当前服务负载均衡器
	provider             oauth.OAuthProvider
	tokenValidator       *auth.TokenValidator // 当前服务JWT校验器
}

type LoadBalancerPolicy struct {
	Type    string        `json:"type" yaml:"type"` // random / roundrobin / weighted / leastconn
	Options PolicyOptions `json:"options,omitempty" yaml:"options,omitempty"`
}

type PolicyOptions struct {
	Weights []int `json:"weights,omitempty" yaml:"weights,omitempty"` // 权重数组，对应多个 upstream
}

// GetHealthCheck performs a health check on the backend service and returns true if it is healthy.
func (bs *BackendService) GetHealthCheck() bool {
	//Get请求访问配置的健康检查地址
	resp, err := http.Get(bs.HealthCheck)
	if err != nil {
		log.Printf("Error performing health check for service %s: %s", bs.Name, err.Error())
		return false
	}
	defer resp.Body.Close()
	// 200状态码就算健康
	if resp.StatusCode >= 200 && resp.StatusCode <= 299 {
		return true
	}

	log.Printf("Service %s health check failed with status code %d", bs.Name, resp.StatusCode)
	return false
}

// 鉴权器
func (bs *BackendService) setTokenValidator() {
	// 单服务独立鉴权配置
	if bs.AuthConfig == nil {
		return
	}

	validator, err := auth.GetTokenValidator(*bs.AuthConfig)
	if err != nil {
		log.Printf("Error adding auth to backend service: %s: %s", bs.Name, err.Error())
	} else {
		bs.tokenValidator = &validator
	}
}

// 懒加载， 网关需要校验JWT / OAuth token时调用
func (bs *BackendService) GetTokenValidator() auth.TokenValidator {
	if bs.AuthConfig != nil && bs.tokenValidator == nil {
		// Token validator has not been instantiated for this backend service
		// Instantiating here to avoid having to call setTokenValidator on each update/add
		bs.setTokenValidator()
	}
	return *bs.tokenValidator
}

// 获取透传给后端业务服务的用户信息HTTP Header名称
func (bs *BackendService) GetUserDataHeader() string {
	if bs.AuthConfig.UserDataHeader != "" {
		return bs.AuthConfig.UserDataHeader
	}
	return "user"
}

func (bs *BackendService) GetLoadBalancer() loadbalancer.LoadBalancer {
	return bs.loadBalancer
}

// GetCompiledRewriteMatch returns the compiled rewrite match regular expression for the backend service.
func (bs *BackendService) GetCompiledRewriteMatch() *regexp.Regexp {
	return bs.compiledRewriteMatch // 预编译正则（性能优化）
}

func (bs *BackendService) GetHttpClient() *http.Client {
	return bs.httpClient
}

func (bs *BackendService) setLoadBalancer() {
	switch bs.LoadBalancerPolicy.Type {
	// 随机， 轮询， 权重轮询， 最小连接数， 加权最小连接数
	case loadbalancer.Random:
		bs.loadBalancer = loadbalancer.NewRandomLoadBalancer()
	case loadbalancer.RoundRobin:
		bs.loadBalancer = loadbalancer.NewRoundRobinLoadBalancer()
	case loadbalancer.WeightedRoundRobin:
		bs.loadBalancer = loadbalancer.NewWRoundRobinLoadBalancer(bs.LoadBalancerPolicy.Options.Weights)
	case loadbalancer.LeastConnection:
		bs.loadBalancer = loadbalancer.NewLeastConnLoadBalancer(bs.UpstreamTargets, nil)
	case loadbalancer.WeightedLeastConnection:
		bs.loadBalancer = loadbalancer.NewLeastConnLoadBalancer(bs.UpstreamTargets, bs.LoadBalancerPolicy.Options.Weights)
	default:
		bs.loadBalancer = loadbalancer.NewRoundRobinLoadBalancer()
	}
}

// CompilePath compiles the rewrite match regular expression for the backend service and
// stores it in the compiledRewriteMatch field. If there's an error while compiling,
// the error is returned.
func (bs *BackendService) compilePath() {
	// RewriteMatch 匹配正则， RewriteReplace 替换模板
	if bs.RewriteMatch == "" || bs.RewriteReplace == "" {
		return
	}

	compiled, err := regexp.Compile(bs.RewriteMatch)
	//只在服务Init阶段编译一次， 不用每一次HTTP请求都Compile, 正则编译开销很大
	if err != nil {
		return
	}

	bs.compiledRewriteMatch = compiled
}

func (bs *BackendService) setHttpClient() {
	//每个BackendService创建独立http.Client与Transport连接池
	transport := &http.Transport{
		MaxIdleConns:        bs.MaxIdleConns,
		IdleConnTimeout:     bs.MaxIdleTime * time.Second,
		TLSHandshakeTimeout: bs.Timeout * time.Second,
	}

	bs.httpClient = &http.Client{Transport: transport}
}

func (bs *BackendService) Init() {
	bs.setTokenValidator() // 初始化鉴权器
	bs.setLoadBalancer()   // 初始化负载均衡器
	bs.setHttpClient()     // 初始化独立连接池
	bs.compilePath()       // 预编译路径重写正则
}

```
## frontman/service/redis_registry.go
> Redis持久化实现
> Go结构体嵌入 自动继承所以方法
```Go
func NewRedisClient(ctx context.Context, uri string) (*redis.Client, error) {
	//解析配置
	opt, err := redis.ParseURL(uri)
	if err != nil {
		return nil, err
	}
	//创建客户端
	client := redis.NewClient(opt)
	//Ping连通性
	_, err = client.Ping(ctx).Result()
	if err != nil {
		return nil, err
	}

	return client, nil
}
// RedisRegistry implements the ServiceRegistry interface using Redis as a backend storage
type RedisRegistry struct {
	*baseRegistry //嵌入结构体方法会提升到外层结构体
	redisClient   *redis.Client
	namespace     string
	ctx           context.Context
}

// NewRedisRegistry creates a new RedisRegistry instance with a Redis client connection
func NewRedisRegistry(ctx context.Context, redisClient *redis.Client, namespace string, br *baseRegistry) (*RedisRegistry, error) {
	r := &RedisRegistry{
		baseRegistry: br,
		redisClient:  redisClient,
		ctx:          ctx,
		namespace:    namespace}
	// 创建基础注册器时从Redis全量大区服务配置加载到内存
	if err := r.loadServices(); err != nil {
		return nil, err
	}

	return r, nil
}

// AddService adds a new backend service to Redis
func (r *RedisRegistry) AddService(service *BackendService) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()
	//序列化
	serviceJSON, err := json.Marshal(service)
	if err != nil {
		return err
	}

	err = r.addService(service, func() error {
		_, err = r.redisClient.RPush(r.ctx, "services", serviceJSON).Result()
		return err
	})

	return err
}

// UpdateService updates an existing backend service in Redis
func (r *RedisRegistry) UpdateService(service *BackendService) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	serviceJSON, err := json.Marshal(service)
	if err != nil {
		return err
	}

	err = r.updateService(service, func() error {
		return r.redisClient.LSet(r.ctx, "services", int64(len(r.services)-1), serviceJSON).Err()
	})

	return err
}

// RemoveService removes a backend service from Redis
func (r *RedisRegistry) RemoveService(name string) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	err := r.removeService(name, func() error {
		return r.redisClient.LRem(r.ctx, "services", 0, name).Err()
	})

	return err
}

// GetServices returns a copy of the current list of backend services
func (r *RedisRegistry) GetServices() []*BackendService {
	r.mutex.RLock()
	defer r.mutex.RUnlock()

	return r.getServices()
}

// ensureListExists creates the services list if it does not exist
func (r *RedisRegistry) ensureListExists() error {
	return r.redisClient.Do(r.ctx, "PING").Err()
}

// loadServices retrieves the list of backend services from Redis
func (r *RedisRegistry) loadServices() error {
	//读取 Redis List中全部元素， 拿到每一条JSON字符串
	services, err := r.redisClient.LRange(r.ctx, "services", 0, -1).Result()
	if err != nil {
		return err
	}

	for _, service := range services {
		var backendService BackendService

		err = json.Unmarshal([]byte(service), &backendService)
		if err != nil {
			return err
		}

		backendService.Init()
		r.services = append(r.services, &backendService)
	}

	return nil
}

```
## frontman/service/mongo.go
> MongoDB持久化实现
```Go
package service

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/mongo"
	"go.mongodb.org/mongo-driver/mongo/options"
)

func NewMongoClient(ctx context.Context, uri string) (*mongo.Client, error) {
	clientOptions := options.Client().ApplyURI(uri)
	client, err := mongo.Connect(ctx, clientOptions)
	if err != nil {
		return nil, err
	}
	err = client.Ping(ctx, nil)
	if err != nil {
		return nil, err
	}
	return client, nil
}

type mongoServiceRegistry struct {
	*baseRegistry
	client        *mongo.Client
	database      *mongo.Database
	collection    *mongo.Collection
	ctx           context.Context
	updateTimeout time.Duration
}

func NewMongoServiceRegistry(ctx context.Context, client *mongo.Client, database string, collection string, br *baseRegistry) (ServiceRegistry, error) {

	r := &mongoServiceRegistry{
		baseRegistry: br,
		client:       client,
		database:     client.Database(database),
		ctx:          ctx,
	}

	r.collection = r.database.Collection(collection)

	err := r.loadServices()
	if err != nil {
		return nil, err
	}

	return r, nil
}

func (r *mongoServiceRegistry) AddService(service *BackendService) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	return r.addService(service, func() error {
		_, err := r.collection.InsertOne(r.ctx, service)
		return err
	})
}

func (r *mongoServiceRegistry) UpdateService(service *BackendService) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	return r.updateService(service, func() error {
		_, err := r.collection.UpdateOne(r.ctx, bson.M{"name": service.Name}, bson.M{"$set": service})
		return err

	})
}

func (r *mongoServiceRegistry) RemoveService(name string) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	return r.removeService(name, func() error {
		_, err := r.collection.DeleteOne(r.ctx, bson.M{"name": name})
		return err
	})
}

func (r *mongoServiceRegistry) GetServices() []*BackendService {
	r.mutex.RLock()
	defer r.mutex.RUnlock()

	return r.getServices()
}

func (r *mongoServiceRegistry) loadServices() error {
	var services []*BackendService

	cursor, err := r.collection.Find(r.ctx, bson.M{})
	if err != nil {
		return err
	}

	defer cursor.Close(r.ctx)

	for cursor.Next(r.ctx) {
		var service BackendService
		err = cursor.Decode(&service)
		if err != nil {
			return err
		}

		service.Init()
		r.services = append(services, &service)
	}

	if err = cursor.Err(); err != nil {
		return err
	}

	return nil
}

```
## frontman/service/memory_registry.go
> 纯内存实现， 是网关默认注册中心
>
> - Memory 内存map落存  
- redis -> redis落存
- Mongo -> MongoDB落存
```Go
package service

// MemoryServiceRegistry is an in-memory implementation of the ServiceRegistry interface
type MemoryServiceRegistry struct {
	*baseRegistry
	Services map[string]*BackendService
}

// NewMemoryServiceRegistry creates a new MemoryServiceRegistry instance
func NewMemoryServiceRegistry(br *baseRegistry) *MemoryServiceRegistry {
	return &MemoryServiceRegistry{
		baseRegistry: br,
		Services:     make(map[string]*BackendService),
	}
}

// AddService adds a new backend service
func (r *MemoryServiceRegistry) AddService(service *BackendService) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	return r.addService(service, func() error {
		r.Services[service.Name] = service
		return nil
	})
}

// UpdateService updates an existing backend service
func (r *MemoryServiceRegistry) UpdateService(service *BackendService) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	return r.updateService(service, func() error {
		r.Services[service.Name] = service
		return nil
	})
}

// RemoveService removes a backend service by name
func (r *MemoryServiceRegistry) RemoveService(name string) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	return r.removeService(name, func() error {
		delete(r.Services, name)
		return nil
	})
}

// GetServices retrieves all backend services
func (r *MemoryServiceRegistry) GetServices() []*BackendService {
	r.mutex.RLock()
	defer r.mutex.RUnlock()

	return r.getServices()
}

```
## frontman/service/yaml.go
> yaml文件持久化实现
```Go
package service

import (
	"io/ioutil"
	"os"

	"gopkg.in/yaml.v3"
)

// YAMLServiceRegistry implements the ServiceRegistry interface
type YAMLServiceRegistry struct {
	*baseRegistry
	filename string
}

// NewYAMLServiceRegistry creates a new YAMLServiceRegistry instance from a file
func NewYAMLServiceRegistry(filename string, br *baseRegistry) (*YAMLServiceRegistry, error) {
	reg := &YAMLServiceRegistry{
		baseRegistry: br,
		filename:     filename}

	err := reg.readFromFile(filename)
	if err != nil {
		return nil, err
	}
	return reg, nil
}

// AddService adds a new backend service to the registry
func (r *YAMLServiceRegistry) AddService(service *BackendService) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	err := r.addService(service, func() error {
		return r.writeToFile(r.filename)
	})

	return err
}

// UpdateService updates an existing backend service in the registry
func (r *YAMLServiceRegistry) UpdateService(service *BackendService) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	err := r.updateService(service, func() error {
		return r.writeToFile(r.filename)
	})

	return err
}

// RemoveService removes a backend service from the registry
func (r *YAMLServiceRegistry) RemoveService(name string) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	err := r.removeService(name, func() error {
		return r.writeToFile(r.filename)
	})

	return err
}

// GetServices returns a copy of the current list of backend services
func (r *YAMLServiceRegistry) GetServices() []*BackendService {
	r.mutex.RLock()
	defer r.mutex.RUnlock()

	return r.baseRegistry.getServices()
}

// readFromFile reads service data from a YAML file and updates the registry
func (r *YAMLServiceRegistry) readFromFile(filename string) error {
	r.mutex.Lock()
	defer r.mutex.Unlock()

	_, err := os.Stat(filename)
	if os.IsNotExist(err) {
		// Create an empty file if it doesn't exist
		err = ioutil.WriteFile(filename, []byte{}, 0644)
		if err != nil {
			return err
		}
	} else if err != nil {
		return err
	}

	data, err := ioutil.ReadFile(filename)
	if err != nil {
		return err
	}

	var services []*BackendService
	err = yaml.Unmarshal(data, &services)
	if err != nil {
		return err
	}
	for _, service := range services {
		service.Init()
	}

	r.services = services

	return nil

}

// WriteToFile writes the current registry data to a YAML file
func (r *YAMLServiceRegistry) writeToFile(filename string) error {
	data, err := yaml.Marshal(r.services)
	if err != nil {
		return err
	}
	return os.WriteFile(filename, data, 0644)
}

```
## frontman/loadbalancer/roundrobin.go
> 实现普通轮询 负载均衡策略
```Go
package loadbalancer

type RoundRobinPolicy struct {
	basePolicy // 继承：互斥锁 mu、轮询下标 currentIndex
}

func NewRoundRobinLoadBalancer() *RoundRobinPolicy {
	return &RoundRobinPolicy{}
}

// 普通轮询， 按请求顺序轮流分配
func (p *RoundRobinPolicy) ChooseTarget(targets []string) string {
	p.mu.Lock()
	defer p.mu.Unlock()

	curr := p.currentIndex
	p.currentIndex = (p.currentIndex + 1) % len(targets)
	return targets[curr]
}

func (p *RoundRobinPolicy) Done(_ string) {}

```

## frontman/loadbalancer/random.go
> 随机负载均衡策略
```Go
package loadbalancer

import (
	"math/rand"
	"time"
)

type RandomPolicy struct{}

func NewRandomLoadBalancer() *RandomPolicy {
	return &RandomPolicy{}
}

func (p *RandomPolicy) ChooseTarget(targets []string) string {
	rand.Seed(time.Now().UnixNano())

	return targets[rand.Intn(len(targets))]
}

func (p *RandomPolicy) Done(_ string) {}

```
## frontman/loadbalancer/weighted_round_robin.go
> 加权轮询负载均衡
```Go
package loadbalancer

// 给每个后端配置权重， 权重大选中次数越多
type WeightedRoundRobinPolicy struct {
	basePolicy          // 继承 mu互斥锁、currentIndex 当前节点下标
	weights       []int // 每个后端对应的权重数组，和targets一一对应
	currentWeight int   // 当前节点剩余可分配次数
}

func NewWRoundRobinLoadBalancer(weights []int) *WeightedRoundRobinPolicy {
	return &WeightedRoundRobinPolicy{
		weights:       weights,
		currentWeight: weights[0],
	}
}

func (p *WeightedRoundRobinPolicy) ChooseTarget(targets []string) string {
	p.mu.Lock()
	defer p.mu.Unlock()

	curr := p.currentIndex

	if p.currentWeight == 0 {
		p.currentWeight = p.weights[p.currentIndex]
	}

	p.currentWeight--
	//切换下一个节点
	if p.currentWeight == 0 {
		p.currentIndex = (p.currentIndex + 1) % len(targets)
	}

	return targets[curr]
}

func (p *WeightedRoundRobinPolicy) Done(_ string) {}

```
## frontman/loadbalancer/least_connections.go
> 最小连接数负载均衡策略
- 优先选择当前活跃连接数最少的后端节点
- 基于最小堆实现动态排序
```Go
package loadbalancer

import "container/heap"

type targetInfo struct {
	target        string // 后端地址
	index         int    // 在堆中的下标
	count         int    // 当前活跃连接数（核心字段）
	weight        int    // 节点权重
	insertionTime uint64 // 入堆时间戳，用于平局排序
}

type targetsHeap struct {
	time     uint64
	heap     []*targetInfo
	weighted bool // 是否开启加权模式
}

func (th targetsHeap) Less(i, j int) bool {
	if th.heap[i].count == th.heap[j].count {
		if th.weighted {
			if th.heap[i].weight == th.heap[j].weight {
				return th.heap[i].insertionTime < th.heap[j].insertionTime
			}

			return th.heap[i].weight > th.heap[j].weight
		}
		// 比较插入时间
		return th.heap[i].insertionTime < th.heap[j].insertionTime
	}
	// 比较活跃连接count
	return th.heap[i].count < th.heap[j].count
}
func (th targetsHeap) Len() int { return len(th.heap) }

func (th targetsHeap) Swap(i, j int) {
	th.heap[i], th.heap[j] = th.heap[j], th.heap[i]
	th.heap[i].index, th.heap[j].index = th.heap[j].index, th.heap[i].index
}

func (th *targetsHeap) Push(x any) {
	// Push and Pop use pointer receivers because they modify the slice's length,
	// not just its contents.
	th.time++
	item := x.(*targetInfo)
	item.index = len(th.heap)
	item.insertionTime = th.time

	th.heap = append(th.heap, item)
}

func (th *targetsHeap) Pop() any {
	old := th.heap
	n := len(old)
	x := old[n-1]
	th.heap = old[0 : n-1]
	return x
}

// 负载均衡策略主体
type LeastConnPolicy struct {
	basePolicy                // 继承并发锁
	minHeap    heap.Interface // 最小堆，自动维护最少连接节点
	// interface  push pop sort.[less swap len]
	targetsMap map[string]*targetInfo // 地址 -> 节点信息映射
}

func NewLeastConnLoadBalancer(targets []string, weights []int) *LeastConnPolicy {
	tm := make(map[string]*targetInfo, len(targets))
	h := targetsHeap{
		time: 0,
		heap: make([]*targetInfo, len(targets)),
	}
	// 遍历后端节点
	for i, t := range targets {
		ti := targetInfo{
			target:        t,
			count:         0,
			index:         i,
			insertionTime: uint64(i),
		}

		if weights != nil {
			ti.weight = weights[i]
		}

		tm[t] = &ti
		h.heap[i] = &ti
		h.weighted = weights != nil
	}
	// 维护堆内部time计数器
	currTime := h.heap[len(h.heap)-1].insertionTime
	h.time = currTime

	heap.Init(&h)

	lb := LeastConnPolicy{
		minHeap:    &h,
		targetsMap: tm,
	}

	return &lb
}

func (p *LeastConnPolicy) ChooseTarget(_ []string) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	// 取出堆顶元素
	min := heap.Pop(p.minHeap).(*targetInfo)
	target := min.target
	min.count++

	heap.Push(p.minHeap, min)

	return target
}

func (p *LeastConnPolicy) Done(target string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	ti := p.targetsMap[target]
	ti.count--
	// 调整堆结构
	heap.Fix(p.minHeap, ti.index)
}

```
## frontman/loadbalancer/loadbalancer.go
> loadbalancer接口与基础结构体
```Go
package loadbalancer

import (
	"sync"
)

const (
	RoundRobin              string = "round_robin"
	WeightedRoundRobin      string = "weighted_round_robin"
	LeastConnection         string = "least_conn"
	WeightedLeastConnection string = "weighted_least_conn"
	Random                  string = "random"
)

type LoadBalancer interface {
	ChooseTarget(targets []string) string
	Done(target string)
}

type basePolicy struct {
	mu           sync.Mutex
	currentIndex int
}

```
## frontman/auth/auth.go
> 网关认证模块的统一入口
> 根据配置AuthType自动创建JWT/Basic认证器
```Go
package auth

import (
	"errors"
	"github.com/Frontman-Labs/frontman/config"
	"net/http"
)

type TokenValidator interface {
	ValidateToken(request *http.Request) (map[string]interface{}, error)
}

func GetTokenValidator(conf config.AuthConfig) (TokenValidator, error) {
	switch conf.AuthType {
	case "jwt":
		return NewJWTValidator(conf.JWT)
	case "basic":
		return NewBasicAuthValidator(conf.BasicAuthConfig)
	default:
		return nil, errors.New("Unrecognized auth type specified")
	}
}

```
## frontman/auth/jwt.go
> JWT校验， 支持从JWKS地址 远程拉取公钥集合， 实现网关Bear Token鉴权
```Go
package auth

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"net/http"

	"github.com/Frontman-Labs/frontman/config"
	"github.com/lestrrat-go/jwx/v2/jwk"
	"github.com/lestrrat-go/jwx/v2/jws"
	"github.com/lestrrat-go/jwx/v2/jwt"
)

// JWTValidator JWT校验器结构体
type JWTValidator struct {
	issuer   string  // 期望的iss签发者
	audience string  // 期望的aud受众
	JWKS     jwk.Set // JWKS公钥集合，存放用于验签的公钥
}

type JWTValidatorOption func(*JWTValidator)

const AuthTypeBearer string = "bearer"

var (
	ErrMissingAuthHeader   = errors.New("missing authorization header")
	ErrBadFormatAuthHeader = errors.New("invalid format for authorization header")
)

func NewJWTValidator(cfg *config.JWTConfig, opts ...JWTValidatorOption) (*JWTValidator, error) {
	jwks := jwk.NewSet()
	if cfg.KeysUrl != "" {
		keySet, err := jwk.Fetch(context.Background(), cfg.KeysUrl)
		if err != nil {
			log.Printf("Error loading jwks from %s: %s", cfg.KeysUrl, err.Error())
			return nil, err
		}
		jwks = keySet
	}
	validator := &JWTValidator{
		issuer:   cfg.Issuer,
		audience: cfg.Audience,
		JWKS:     jwks,
	}
	for _, opt := range opts {
		opt(validator)
	}
	return validator, nil
}

func (v JWTValidator) ValidateToken(request *http.Request) (map[string]interface{}, error) {
	tokenString := request.Header.Get("Authorization")
	if len(tokenString) == 0 {
		return nil, ErrMissingAuthHeader
	}
	splitToken := strings.Fields(tokenString)
	if len(splitToken) < 2 {
		return nil, ErrBadFormatAuthHeader
	}
	if strings.ToLower(splitToken[0]) != AuthTypeBearer {
		return nil, fmt.Errorf("unsupported authorization type, expected 'Bearer' %w", http.ErrNotSupported)
	}
	token := splitToken[len(splitToken)-1]
	result, err := jwt.Parse([]byte(token), jwt.WithKeySet(v.JWKS, jws.WithInferAlgorithmFromKey(true)))
	if err != nil {
		return nil, err
	}
	return result.PrivateClaims(), nil
}

```
## frontman/auth/basic.go
> Basic认证校验器
```Go
package auth

import (
	"errors"
	"log"
	"net/http"
	"os"

	"github.com/Frontman-Labs/frontman/config"
	"gopkg.in/yaml.v3"
)

type BasicAuthValidator struct {
	Username string `yaml:"username"`
	Password string `yaml:"password"`
}

func getCredentialsFromConfig(conf *config.BasicAuthConfig) (string, string) {
	var username, password string
	if conf.Username != "" {
		username = conf.Username
	} else {
		username = os.Getenv(conf.UsernameEnv)
	}

	if conf.Password != "" {
		password = conf.Password
	} else {
		password = os.Getenv(conf.PasswordEnv)
	}

	return username, password
}

func NewBasicAuthValidator(conf *config.BasicAuthConfig) (*BasicAuthValidator, error) {
	if conf.CredentialsFile != "" {
		// Read credentials file to build validator
		yamlData, err := os.ReadFile(conf.CredentialsFile)
		if err != nil {
			log.Printf("Failed to read credentials file: %s", err)
			return nil, err
		}
		validator := &BasicAuthValidator{}
		err = yaml.Unmarshal(yamlData, validator)
		if err != nil {
			log.Printf("Failed to unmarshal credentials data: %s", err)
			return nil, err
		}
		return validator, nil
	}
	username, password := getCredentialsFromConfig(conf)
	return &BasicAuthValidator{
		Username: username,
		Password: password,
	}, nil
}

func (v BasicAuthValidator) ValidateToken(request *http.Request) (map[string]interface{}, error) {
	username, password, ok := request.BasicAuth()
	if !ok {
		return nil, errors.New("Error parsing authentication token")
	}

	if username != v.Username || password != v.Password {
		return nil, errors.New("Invalid credentials")
	}

	return nil, nil
}

```
## frontman/plugins/plugins.go
> 外部.so插件动态加载， 请求前置拦截， 响应后置拦截
> 实现网关 热插拔， 可扩展， 自定义中间件
```Go
package plugins

import (
	"fmt"

	"net/http"

	"plugin"

	"github.com/Frontman-Labs/frontman/config"
	"github.com/Frontman-Labs/frontman/service"
)

type PluginError interface {
	StatusCode() int
	Error() string
}

// FrontmanPlugin is an interface for creating plugins for Frontman.
type FrontmanPlugin interface {
	// Name returns the name of the plugin.
	Name() string

	// PreRequest is called before sending the request to the target service.
	// The method takes in the original request, a ServiceRegistry, and a Config.
	// An error is returned if the plugin encounters any issues.
	PreRequest(*http.Request, service.ServiceRegistry, *config.Config) PluginError

	// PostResponse is called after receiving the response from the target service.
	// The method takes in the response, a ServiceRegistry, and a Config.
	// An error is returned if the plugin encounters any issues.
	PostResponse(*http.Response, service.ServiceRegistry, *config.Config) PluginError

	// Close is called when the plugin is being shut down.
	// An error is returned if the plugin encounters any issues.
	Close() PluginError
}

// LoadPlugins loads the plugins in the specified order and returns a slice of FrontmanPlugin instances.
func LoadPlugins(pluginPaths []string) ([]FrontmanPlugin, error) {
	plugins := make([]FrontmanPlugin, 0)

	// Iterate through each plugin file path
	for _, path := range pluginPaths {
		//遍历所有插件路径， 打开.so插件文件
		// Load the plugin
		p, err := plugin.Open(path)
		if err != nil {
			return nil, fmt.Errorf("failed to load plugin %s: %v", path, err)
		}

		// Get the symbol for the FrontmanPlugin instance
		sym, err := p.Lookup("FrontmanPlugin")
		if err != nil {
			return nil, fmt.Errorf("failed to get symbol for plugin %s: %v", path, err)
		}

		// Check that the symbol is of the correct type
		// 断言
		frontmanPlugin, ok := sym.(FrontmanPlugin)
		if !ok {
			return nil, fmt.Errorf("symbol for plugin %s is not of type FrontmanPlugin", path)
		}

		// Add the plugin to the slice of plugins
		plugins = append(plugins, frontmanPlugin)
	}

	return plugins, nil
}

```
## frontman/log/logger.go
> 封装日志抽象接口， 结构化Field字段， 日志级别解析
> 面向接口设计
```Go
package log

import (
	"fmt"
)

type logLevel string

const (
	InfoLevel    logLevel  = "info"
	DebugLevel   logLevel  = "debug"
	WarnLevel    logLevel  = "warn"
	ErrorLevel   logLevel  = "error"
	boolField    fieldType = "bool"
	stringField  fieldType = "string"
	integerField fieldType = "integer"
)

type Logger interface {
	Debug(args ...interface{})
	Debugf(format string, args ...interface{})
	Info(args ...interface{})
	Infof(format string, args ...interface{})
	Error(args ...interface{})
	Errorf(format string, args ...interface{})
	Warn(args ...interface{})
	Warnf(format string, args ...interface{})
	Fatal(args ...interface{})
	Fatalf(format string, args ...interface{})
	WithFields(level logLevel, msg string, fields ...Field)
}

// Field used for structured logging
type Field struct {
	key          string
	stringValue  string
	integerValue int64
	value        interface{}
	fieldType    fieldType
}

type fieldType string

// 构造Field的工具函数
func String(key string, value string) Field {
	return Field{
		key:         key,
		stringValue: value,
		fieldType:   stringField,
	}
}

func Bool(key string, value bool) Field {
	var val int64
	if value {
		val = 1
	}
	return Field{
		key:          key,
		integerValue: val,
		fieldType:    boolField,
	}
}

func Int(key string, value int64) Field {
	return Field{
		key:          key,
		integerValue: value,
		fieldType:    integerField,
	}
}

func Error(value string) Field {
	return Field{
		key:   "err",
		value: value,
	}
}

//字符串转日志级别

func ParseLevel(str string) logLevel {
	var lvl logLevel
	lvl.unmarshalString(str)
	return lvl
}

func (l *logLevel) unmarshalString(str string) {
	switch str {
	case "debug", "DEBUG":
		*l = DebugLevel
	case "info", "INFO", "": // make the zero value useful
		*l = InfoLevel
	case "warn", "WARN":
		*l = WarnLevel
	case "error", "ERROR":
		*l = ErrorLevel
	default:
		fmt.Println("unknown log level ", str, " proceeding with log levle Info")
		*l = InfoLevel
	}
}

```
## frontman/log/zap.go
> 基础uber Zap实现
```Go
package log

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

type ZapLogger struct {
	zap      *zap.Logger
	sugarZap *zap.SugaredLogger
}

func (l ZapLogger) Debugf(format string, args ...interface{}) {
	l.sugarZap.Debugf(format, args...)
}

func (l ZapLogger) Debug(args ...interface{}) {
	l.sugarZap.Debug(args...)
}

func (l ZapLogger) Fatalf(format string, args ...interface{}) {
	l.sugarZap.Fatalf(format, args...)
}

func (l ZapLogger) Fatal(args ...interface{}) {
	l.sugarZap.Fatal(args...)
}

func (l ZapLogger) Infof(format string, args ...interface{}) {
	l.sugarZap.Infof(format, args...)
}

func (l ZapLogger) Info(args ...interface{}) {
	l.sugarZap.Info(args...)
}

func (l ZapLogger) Warnf(format string, args ...interface{}) {
	l.sugarZap.Warnf(format, args...)
}

func (l ZapLogger) Warn(args ...interface{}) {
	l.sugarZap.Warn(args...)
}
func (l ZapLogger) Errorf(format string, args ...interface{}) {
	l.sugarZap.Errorf(format, args...)
}

func (l ZapLogger) Error(args ...interface{}) {
	l.sugarZap.Error(args...)
}

// 转换器
func fieldsToZap(fields ...Field) (zfields []zapcore.Field) {
	for _, field := range fields {
		zfields = append(zfields, zap.Field{
			Key:       field.key,
			String:    field.stringValue,
			Integer:   field.integerValue,
			Interface: field.value,
			Type:      field.GetZapType(),
		})
	}

	return zfields
}

// 翻译成 Zap内部的字段枚举
func (f *Field) GetZapType() zapcore.FieldType {
	switch f.fieldType {
	case stringField:
		return zapcore.StringType
	case boolField:
		return zapcore.BoolType
	case integerField:
		return zapcore.Int64Type
	default:
		return zapcore.StringType
	}

}

func (l ZapLogger) WithFields(level logLevel, msg string, fields ...Field) {
	lvl, err := zapcore.ParseLevel(string(level))
	if err != nil {
		l.Error("Unknown log level: %s", level)
		lvl = zap.InfoLevel
	}
	l.zap.Log(lvl, msg, fieldsToZap(fields...)...)
}

// 创建日志实例
func NewZapLogger(level logLevel) (Logger, error) {
	cfg := zap.NewProductionConfig()
	lvl, err := zapcore.ParseLevel(string(level))
	if err != nil {
		return nil, err
	}
	cfg.Level = zap.NewAtomicLevelAt(lvl)
	zap, err := cfg.Build(zap.AddCallerSkip(1))
	if err != nil {
		return nil, err
	}
	logger := &ZapLogger{
		zap:      zap,
		sugarZap: zap.Sugar(),
	}
	return logger, nil
}

func NewDefaultLogger(level logLevel) (Logger, error) {
	return NewZapLogger(level)
}

```
## frontman/api/api.go
> 网关HTTP管理API
```Go
package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"

	"github.com/Frontman-Labs/frontman/loadbalancer"

	"github.com/Frontman-Labs/frontman/service"
	"github.com/julienschmidt/httprouter"
)

func NewServicesRouter(backendServices service.ServiceRegistry) *httprouter.Router {
	router := httprouter.New()

	router.GET("/api/services", getServicesHandler(backendServices))
	router.POST("/api/services", addServiceHandler(backendServices))
	router.DELETE("/api/services/:name", removeServiceHandler(backendServices))
	router.PUT("/api/services/:name", updateServiceHandler(backendServices))
	router.GET("/api/health", getHealthHandler(backendServices))

	return router
}

// 查询全部服务
func getServicesHandler(bs service.ServiceRegistry) httprouter.Handle {
	return func(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
		services := bs.GetServices()
		jsonData, err := json.Marshal(services)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		prepareHeaders(w, http.StatusOK)
		w.Write(jsonData)
	}
}

// 健康检查接口
func getHealthHandler(bs service.ServiceRegistry) httprouter.Handle {
	return func(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
		services := bs.GetServices()
		healthStatus := make(map[string]bool)
		for _, service := range services {
			healthStatus[service.Name] = service.GetHealthCheck()
		}

		prepareHeaders(w, http.StatusOK)
		json.NewEncoder(w).Encode(healthStatus)
	}
}

// 新增服务
func addServiceHandler(bs service.ServiceRegistry) httprouter.Handle {
	return func(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
		// Parse the request body as a BackendService object
		var service service.BackendService
		err := json.NewDecoder(r.Body).Decode(&service)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Validate service
		err = validateService(&service)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Add the service to the list of backend services
		err = bs.AddService(&service)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Write a response to the HTTP client indicating that the service was added successfully
		prepareHeaders(w, http.StatusCreated)
		json.NewEncoder(w).Encode(service)
	}
}

// 更新服务
func updateServiceHandler(bs service.ServiceRegistry) httprouter.Handle {
	return func(w http.ResponseWriter, r *http.Request, params httprouter.Params) {
		name := params.ByName("name")
		// Parse the request body as a BackendService object
		var service service.BackendService
		err := json.NewDecoder(r.Body).Decode(&service)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		service.Name = name

		err = validateService(&service)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		// Update the service in the list of backend services
		err = bs.UpdateService(&service)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Write a response to the HTTP client indicating that the service was updated successfully
		prepareHeaders(w, http.StatusOK)
		json.NewEncoder(w).Encode(service)
	}
}

// 删除服务
func removeServiceHandler(bs service.ServiceRegistry) httprouter.Handle {
	type Response struct {
		Message string `json:"message,omitempty"`
		Error   string `json:"error,omitempty"`
	}

	return func(w http.ResponseWriter, r *http.Request, params httprouter.Params) {
		name := params.ByName("name")
		err := bs.RemoveService(name)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		prepareHeaders(w, http.StatusOK)
		json.NewEncoder(w).Encode(Response{
			Message: "Removed service " + name,
		})
	}
}

func validateService(service *service.BackendService) error {
	// Validate that the required fields are present
	if service.Path == "" {
		return fmt.Errorf("path is a required field")
	}

	// Validate that at least one upstream target is specified and that each target is a valid URL
	if len(service.UpstreamTargets) < 1 {
		return fmt.Errorf("at least one upstream target is required")
	}
	for _, target := range service.UpstreamTargets {
		u, err := url.Parse(target)
		if err != nil {
			return fmt.Errorf("Invalid upstream target: " + target)
		}
		if u.Scheme == "" {
			return fmt.Errorf("Upstream target " + target + " must include a scheme (e.g., 'http' or 'https')")
		}
	}

	// If the scheme is not specified, default to "http"
	if service.Scheme == "" {
		service.Scheme = "http"
	}

	// If no timeout is specified, default to 10 seconds
	if service.Timeout == 0 {
		service.Timeout = 10
	}

	// If no policy type is specified, default to round-robin
	if service.LoadBalancerPolicy.Type == "" {
		service.LoadBalancerPolicy.Type = loadbalancer.RoundRobin
	}

	// Validate load-balancer policy and set
	err := validateLoadBalancerPolicy(service)
	if err != nil {
		return err
	}

	err = validateMatchPath(service)
	if err != nil {
		return err
	}

	service.Init()

	return nil
}

// 校验负载均衡策略
func validateLoadBalancerPolicy(bs *service.BackendService) error {
	switch bs.LoadBalancerPolicy.Type {
	case loadbalancer.Random:
	case loadbalancer.LeastConnection:
	case loadbalancer.RoundRobin:
	case loadbalancer.WeightedRoundRobin, loadbalancer.WeightedLeastConnection:
		if len(bs.LoadBalancerPolicy.Options.Weights) != len(bs.UpstreamTargets) {
			return fmt.Errorf("mismatched lengths of weights and targets")
		}

		for _, w := range bs.LoadBalancerPolicy.Options.Weights {
			if w <= 0 {
				return fmt.Errorf("weights must be greater than zero")
			}
		}
	default:
		return fmt.Errorf("unknown load-balancer policy: %s", bs.LoadBalancerPolicy.Type)
	}

	return nil
}

// 校验重写正则
func validateMatchPath(bs *service.BackendService) error {
	if bs.RewriteMatch == "" || bs.RewriteReplace == "" {
		return nil
	}
	_, err := regexp.Compile(bs.RewriteMatch)
	if err != nil {
		return err
	}

	return nil
}

func prepareHeaders(w http.ResponseWriter, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
}

```

## frontman/oauth/oauth.go
> 对OAuth2第三方登录做接口抽象层
```Go
package oauth

import (
	"golang.org/x/oauth2"
)

type OAuthProvider interface {
	// GetAuthorizationURL 返回跳转给第三方登录页面的URL
	GetAuthorizationURL(state string) string
	// ExchangeCodeForToken 用授权code换取access_token令牌
	ExchangeCodeForToken(code string, state string) (*oauth2.Token, error)
	// GetUserInfo 使用access_token拉取用户信息
	GetUserInfo(token *oauth2.Token) (interface{}, error)
}


```
## frontman/oauth/google.go
> 谷歌OAuth具体实现笔记
```Go
package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"golang.org/x/oauth2"
)

type GoogleOAuthProvider struct {
	Config *oauth2.Config
}

type GoogleUserInfo struct {
	Sub       string `json:"sub"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Picture   string `json:"picture"`
	Locale    string `json:"locale"`
	ExpiresIn int64  `json:"expires_in"`
}

func NewGoogleOAuthProvider(clientID string, clientSecret string, redirectURL string, scopes []string) *GoogleOAuthProvider {
	config := &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		Scopes:       scopes,
		Endpoint: oauth2.Endpoint{
			AuthURL:  "https://accounts.google.com/o/oauth2/auth",
			TokenURL: "https://accounts.google.com/o/oauth2/token",
		},
	}

	return &GoogleOAuthProvider{Config: config}
}

func (p *GoogleOAuthProvider) GetAuthorizationURL(state string) string {
	return p.Config.AuthCodeURL(state)
}

func (p *GoogleOAuthProvider) ExchangeCodeForToken(code string, state string) (*oauth2.Token, error) {
	token, err := p.Config.Exchange(context.Background(), code)
	if err != nil {
		return nil, err
	}

	if state != "" && token.Extra("state") != state {
		return nil, fmt.Errorf("invalid OAuth state")
	}

	return token, nil
}

func (p *GoogleOAuthProvider) GetUserInfo(token *oauth2.Token) (interface{}, error) {
	resp, err := http.Get(fmt.Sprintf("https://www.googleapis.com/oauth2/v2/userinfo?access_token=%s", token.AccessToken))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to get user info, status: %s", resp.Status)
	}

	var userInfo GoogleUserInfo
	err = json.NewDecoder(resp.Body).Decode(&userInfo)
	if err != nil {
		return nil, err
	}

	return &userInfo, nil
}

```

## frontman/oauth/keyclock.go
> 单点登录实现
```Go
package oauth

import (
	"context"
	"encoding/json"

	"golang.org/x/oauth2"
)

type KeycloakProvider struct {
	clientID     string
	clientSecret string
	redirectURI  string
	authURL      string
	tokenURL     string
	userinfoURL  string
}

func NewKeycloakProvider(clientID, clientSecret, redirectURI, authURL, tokenURL, userinfoURL string) *KeycloakProvider {
	return &KeycloakProvider{
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
		authURL:      authURL,
		tokenURL:     tokenURL,
		userinfoURL:  userinfoURL,
	}
}

func (kp *KeycloakProvider) GetAuthorizationURL(state string) string {
	conf := &oauth2.Config{
		ClientID:     kp.clientID,
		ClientSecret: kp.clientSecret,
		RedirectURL:  kp.redirectURI,
		Endpoint: oauth2.Endpoint{
			AuthURL:  kp.authURL,
			TokenURL: kp.tokenURL,
		},
		Scopes: []string{"openid", "profile", "email"},
	}

	return conf.AuthCodeURL(state)
}

func (kp *KeycloakProvider) ExchangeCodeForToken(code string, state string) (*oauth2.Token, error) {
	conf := &oauth2.Config{
		ClientID:     kp.clientID,
		ClientSecret: kp.clientSecret,
		RedirectURL:  kp.redirectURI,
		Endpoint: oauth2.Endpoint{
			AuthURL:  kp.authURL,
			TokenURL: kp.tokenURL,
		},
		Scopes: []string{"openid", "profile", "email"},
	}

	token, err := conf.Exchange(oauth2.NoContext, code)
	if err != nil {
		return nil, err
	}

	return token, nil
}

func (kp *KeycloakProvider) GetUserInfo(token *oauth2.Token) (interface{}, error) {
	httpClient := oauth2.NewClient(context.Background(), oauth2.StaticTokenSource(token))
	resp, err := httpClient.Get(kp.userinfoURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var userInfo map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&userInfo)
	if err != nil {
		return nil, err
	}

	return userInfo, nil
}

```