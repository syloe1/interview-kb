## main.go
>  Janus(API网关的入口)
> 创建 Cobra 根命令、启动命令行框架、捕获顶层错误并打印日志，网关核心业务代码不在这。
```Go
package main

import (
	"github.com/hellofresh/janus/cmd"
	log "github.com/sirupsen/logrus"
)

var version = "0.0.0-dev"

func main() {
	rootCmd := cmd.NewRootCmd(version)

	if err := rootCmd.Execute(); err != nil {
		log.WithError(err).Fatal("Could not run command")
	}
}

```
## cmd/root.go
> 创建 Janus 的根命令（`janus` 主命令），注册全局 flag，挂载 2 个子命令：`check` 和 `server start`，返回根命令对象给 main.go。
```Go
main.go
	→ NewRootCmd(version)
		→ 构造根命令janus
		→ 注册全局 -c/--config 参数
		→ 注册子命令 check + server start
	→ rootCmd.Execute() 解析终端输入

package cmd

import (
	"context"

	"github.com/spf13/cobra"
)

var configFile string

// NewRootCmd creates a new instance of the root command
func NewRootCmd(version string) *cobra.Command {
	ctx := context.Background()

	cmd := &cobra.Command{
		Use:     "janus",
		Version: version,
		Short:   "Janus is an API Gateway",
		Long: `
This is a lightweight API Gateway and Management Platform that enables you
to control who accesses your API, when they access it and how they access it.
API Gateway will also record detailed analytics on how your users are interacting
with your API and when things go wrong.
Complete documentation is available at https://hellofresh.gitbooks.io/janus`,
	}

	cmd.PersistentFlags().StringVarP(&configFile, "config", "c", "", "Config file (default is $PWD/janus.toml)")

	cmd.AddCommand(NewCheckCmd(ctx))
	cmd.AddCommand(NewServerStartCmd(ctx, version))

	return cmd
}

```
## cmd/server.go
> 定义 `janus server start` 子命令，**网关真正启动逻辑入口**。
当执行 `janus server start -c xxx.toml`，最终走到 `RunServerStart`，完成：日志初始化 → 加载配置 → 数据库仓库构建 → 创建网关 server 实例 → 启动网关 + 监听信号做优雅关闭。
```Go
package cmd

import (
	"context"
	"fmt"

	"github.com/hellofresh/janus/pkg/api"
	"github.com/hellofresh/janus/pkg/server"
	log "github.com/sirupsen/logrus"
	"github.com/spf13/cobra"

	// this is needed to call the init function on each plugin
	_ "github.com/hellofresh/janus/pkg/plugin/basic"
	_ "github.com/hellofresh/janus/pkg/plugin/bodylmt"
	_ "github.com/hellofresh/janus/pkg/plugin/cb"
	_ "github.com/hellofresh/janus/pkg/plugin/compression"
	_ "github.com/hellofresh/janus/pkg/plugin/cors"
	_ "github.com/hellofresh/janus/pkg/plugin/oauth2"
	_ "github.com/hellofresh/janus/pkg/plugin/organization"
	_ "github.com/hellofresh/janus/pkg/plugin/rate"
	_ "github.com/hellofresh/janus/pkg/plugin/requesttransformer"
	_ "github.com/hellofresh/janus/pkg/plugin/responsetransformer"
	_ "github.com/hellofresh/janus/pkg/plugin/retry"

	// dynamically registered auth providers
	_ "github.com/hellofresh/janus/pkg/jwt/basic"
	_ "github.com/hellofresh/janus/pkg/jwt/github"
)

// ServerStartOptions are the command flags
type ServerStartOptions struct {
	profilingEnabled bool // 是否开启pprof性能剖析
	profilingPublic  bool // pprof接口是否免认证访问
}


// NewServerStartCmd creates a new http server command
func NewServerStartCmd(ctx context.Context, version string) *cobra.Command {
	opts := &ServerStartOptions{}

	cmd := &cobra.Command{
		Use:   "start",
		Short: "Starts a Janus web server",
        // RunE：带error返回值的执行回调。执行子命令时触发这个函数
		RunE: func(cmd *cobra.Command, args []string) error {
			return RunServerStart(ctx, opts, version)
		},
	}

	cmd.PersistentFlags().BoolVarP(&opts.profilingEnabled, "profiling-enabled", "", false, "Enable profiler, will be available on API port at /debug/pprof path")
	cmd.PersistentFlags().BoolVarP(&opts.profilingPublic, "profiling-public", "", false, "Allow accessing profiler endpoint w/out authentication")

	return cmd
}
RunServerStart
            1. 日志初始化
            2. initConfig() 加载toml配置
            3. metrics/tracing初始化
            4. api.BuildRepository：加载路由配置（DB）
            5. server.New 创建网关实例（选项模式）
            6. ContextWithSignal：绑定操作系统退出信号
            7. svr.StartWithContext(ctx) 启动http网关监听
            8. svr.Wait() 阻塞，等待关闭信号，优雅退出
// RunServerStart is the run command to start Janus
func RunServerStart(ctx context.Context, opts *ServerStartOptions, version string) error {
	// 提前初始化log writer，防止docker环境丢失启动日志
	initLogWriterEarly()
	log.WithField("version", version).Info("Janus starting...")

	initConfig()        // 读取前面 --config 指定的toml配置，加载到globalConfig全局配置
	initLog()           // 根据配置初始化日志级别、输出格式
	initStatsClient()   // 指标客户端（prometheus等metrics）
	initStatsExporter()  // 指标导出器
	initTracingExporter() // 链路追踪（Jaeger等）

	defer statsClient.Close()       // 退出时关闭指标客户端
	defer globalConfig.Log.Flush()  // 刷日志缓冲区

	// 构建API路由仓库：连接数据库，加载网关路由配置
	repo, err := api.BuildRepository(globalConfig.Database.DSN, globalConfig.Cluster.UpdateFrequency)
	if err != nil {
		return fmt.Errorf("could not build a repository for the database: %w", err)
	}
	defer repo.Close()

	// 创建网关服务实例，选项模式注入依赖
	svr := server.New(
		server.WithGlobalConfig(globalConfig),
		server.WithMetricsClient(statsClient),
		server.WithProvider(repo),
		server.WithProfiler(opts.profilingEnabled, opts.profilingPublic),
	)

	// 包装ctx：监听系统信号 SIGINT/SIGTERM，收到信号自动cancel上下文，优雅关闭
	ctx = ContextWithSignal(ctx)
	svr.StartWithContext(ctx) // 启动网关（非阻塞，启动监听后立刻返回）
	defer svr.Close()
	svr.Wait() // 阻塞等待：直到收到关闭信号，网关全部连接处理完毕
	log.Info("Shutting down")
	return nil
}


```
## pkg/config/specification.go
> 用结构体定义网关**全部配置项**；基于 `viper` 读取 TOML/YAML 配置文件，`envconfig` 读取环境变量；内置默认值；最终把配置反序列化成 `Specification` 对象，给网关其他模块使用。
```Go
package config

import (
	"fmt"
	"time"

	"github.com/hellofresh/logging-go"
	"github.com/kelseyhightower/envconfig"
	"github.com/mitchellh/go-homedir"
	"github.com/spf13/viper"
)

// Specification for basic configurations
type Specification struct {
	Port                 int           `envconfig:"PORT"`
	GraceTimeOut         int64         `envconfig:"GRACE_TIMEOUT"`
	MaxIdleConnsPerHost  int           `envconfig:"MAX_IDLE_CONNS_PER_HOST"`
	BackendFlushInterval time.Duration `envconfig:"BACKEND_FLUSH_INTERVAL"`
	IdleConnTimeout      time.Duration `envconfig:"IDLE_CONN_TIMEOUT"`
	ConnPurgeInterval    time.Duration `envconfig:"CONN_PURGE_INTERVAL"`
	RequestID            bool          `envconfig:"REQUEST_ID_ENABLED"`
	Log                  logging.LogConfig
	Web                  Web
	Database             Database
	Stats                Stats
	Tracing              Tracing
	TLS                  TLS
	Cluster              Cluster
	RespondingTimeouts   RespondingTimeouts
}

// Cluster represents the cluster configuration
type Cluster struct {
	//路由更新轮询间隔
	UpdateFrequency time.Duration `envconfig:"BACKEND_UPDATE_FREQUENCY"`
}

// RespondingTimeouts contains timeout configurations for incoming requests to the Janus instance.
type RespondingTimeouts struct {
	ReadTimeout  time.Duration `envconfig:"RESPONDING_TIMEOUTS_READ_TIMEOUT"`
	WriteTimeout time.Duration `envconfig:"RESPONDING_TIMEOUTS_WRITE_TIMEOUT"`
	IdleTimeout  time.Duration `envconfig:"RESPONDING_TIMEOUTS_IDLE_TIMEOUT"`
}

// Web represents the API configurations
type Web struct {
	Port        int `envconfig:"API_PORT"`
	Credentials Credentials
	TLS         TLS
}

// TLS represents the TLS configurations
type TLS struct {
	Port int `envconfig:"PORT"`
	//证书文件路径
	CertFile string `envconfig:"CERT_PATH"`
	//：私钥文件路径
	KeyFile string `envconfig:"KEY_PATH"`
	//是否开启 HTTP 强制跳转 HTTPS
	Redirect bool `envconfig:"REDIRECT"`
}

// IsHTTPS checks if you have https enabled
func (s *TLS) IsHTTPS() bool {
	return s.CertFile != "" && s.KeyFile != ""
}

// Database holds the configuration for a database
type Database struct {
	DSN string `envconfig:"DATABASE_DSN"`
}

// Stats holds the configuration for stats
type Stats struct {
	DSN                   string   `envconfig:"STATS_DSN"`
	IDs                   string   `envconfig:"STATS_IDS"`
	AutoDiscoverThreshold uint     `envconfig:"STATS_AUTO_DISCOVER_THRESHOLD"`
	AutoDiscoverWhiteList []string `envconfig:"STATS_AUTO_DISCOVER_WHITE_LIST"`
	ErrorsSection         string   `envconfig:"STATS_ERRORS_SECTION"`
	Exporter              string   `envconfig:"STATS_EXPORTER"`
}

// Credentials represents the credentials that are going to be
// used by admin JWT configuration
type Credentials struct {
	// Algorithm defines admin JWT signing algorithm.
	// Currently the following algorithms are supported: HS256, HS384, HS512.
	Algorithm      string        `envconfig:"ALGORITHM"`
	Secret         string        `envconfig:"SECRET"`
	JanusAdminTeam string        `envconfig:"JANUS_ADMIN_TEAM"`
	Timeout        time.Duration `envconfig:"TOKEN_TIMEOUT"`
	Github         Github
	Basic          Basic
}

// Basic holds the basic users configurations
type Basic struct {
	Users map[string]string `envconfig:"BASIC_USERS"`
}

// Github holds the github configurations
type Github struct {
	Organizations []string          `envconfig:"GITHUB_ORGANIZATIONS"`
	Teams         map[string]string `envconfig:"GITHUB_TEAMS"`
}

// IsConfigured checks if github is enabled
func (auth *Github) IsConfigured() bool {
	return len(auth.Organizations) > 0 ||
		len(auth.Teams) > 0
}

// Tracing represents the distributed tracing configuration
type Tracing struct {
	Exporter         string        `envconfig:"TRACING_EXPORTER"`
	ServiceName      string        `envconfig:"TRACING_SERVICE_NAME"`
	SamplingStrategy string        `envconfig:"TRACING_SAMPLING_STRATEGY"`
	SamplingParam    float64       `envconfig:"TRACING_SAMPLING_PARAM"`
	DebugTraceKey    string        `envconfig:"TRACING_DEBUG_TRACE_KEY"`
	IsPublicEndpoint bool          `envconfig:"TRACING_IS_PUBLIC_ENDPOINT"`
	JaegerTracing    JaegerTracing `mapstructure:"jaeger"`
}

// JaegerTracing holds the Jaeger tracing configuration
type JaegerTracing struct {
	SamplingServerURL  string `envconfig:"TRACING_JAEGER_SAMPLING_SERVER_URL"`
	SamplingServerHost string `envconfig:"JAEGER_AGENT_HOST"`
	SamplingServerPort string `envconfig:"JAEGER_AGENT_PORT"`
}

func init() {
	serviceName := "janus"

	viper.SetDefault("port", "8080")
	viper.SetDefault("tls.port", "8433")
	viper.SetDefault("tls.redirect", true)
	viper.SetDefault("backendFlushInterval", "20ms")
	viper.SetDefault("requestID", true)

	viper.SetDefault("respondingTimeouts.IdleTimeout", 180*time.Second)

	viper.SetDefault("cluster.updateFrequency", "10s")
	viper.SetDefault("database.dsn", "file:///etc/janus")

	viper.SetDefault("web.port", "8081")
	viper.SetDefault("web.tls.port", "8444")
	viper.SetDefault("web.tls.redirect", true)
	viper.SetDefault("web.credentials.algorithm", "HS256")
	viper.SetDefault("web.credentials.timeout", time.Hour)
	viper.SetDefault("web.credentials.basic.users", map[string]string{"admin": "admin"})
	viper.SetDefault("web.credentials.github.teams", make(map[string]string))

	viper.SetDefault("stats.dsn", "log://")
	viper.SetDefault("stats.errorsSection", "error-log")
	viper.SetDefault("stats.namespace", serviceName)

	viper.SetDefault("tracing.serviceName", serviceName)
	viper.SetDefault("tracing.samplingStrategy", "probabilistic")
	viper.SetDefault("tracing.samplingParam", 0.15)
	viper.SetDefault("tracing.debugTraceKey", "")
	viper.SetDefault("tracing.isPublicEndpoint", true)

	logging.InitDefaults(viper.GetViper(), "log")
}

// Load configuration variables
func Load(configFile string) (*Specification, error) {
	if configFile != "" {
		viper.SetConfigFile(configFile)
	} else {
		//获取根目录
		dir, err := homedir.Dir()
		if err != nil {
			return nil, err
		}

		viper.SetConfigName("janus")
		viper.AddConfigPath(".")
		viper.AddConfigPath(dir)
		viper.AddConfigPath("/etc/janus")
	}

	if err := viper.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("config file not found: %w", err)
	}

	var config Specification
	if err := viper.Unmarshal(&config); err != nil {
		return nil, err
	}

	return &config, nil
}

// LoadEnv loads configuration from environment variables
func LoadEnv() (*Specification, error) {
	var config Specification

	// ensure the defaults are loaded
	if err := viper.Unmarshal(&config); err != nil {
		return nil, err
	}

	err := envconfig.Process("", &config)
	if err != nil {
		return nil, err
	}

	return &config, nil
}

```
## pkg/api/api.go
> 描述**一条代理路由规则**：路由名称、是否启用、转发代理配置、插件、后端健康检查；
同时包含：路由的增 / 改 / 删事件消息、结构体校验、自定义 JSON 反序列化。
```Go
package api

import (
	"encoding/json"
	"reflect"

	"github.com/asaskevich/govalidator"
	"github.com/hellofresh/janus/pkg/proxy"
)

// Plugin represents the plugins for an API
type Plugin struct {
	Name    string                 `bson:"name" json:"name"`
	Enabled bool                   `bson:"enabled" json:"enabled"`
	Config  map[string]interface{} `bson:"config" json:"config"`
}

// Definition represents an API that you want to proxy
// 一条路由定义
type Definition struct {
	Name        string            `bson:"name" json:"name" valid:"required~name is required,matches(^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$)~name cannot contain non-URL friendly characters"`
	Active      bool              `bson:"active" json:"active"`
	Proxy       *proxy.Definition `bson:"proxy" json:"proxy" valid:"required"`
	Plugins     []Plugin          `bson:"plugins" json:"plugins"`
	HealthCheck HealthCheck       `bson:"health_check" json:"health_check"`
}

// HealthCheck represents the health check configs
type HealthCheck struct {
	URL     string `bson:"url" json:"url" valid:"url"`
	Timeout int    `bson:"timeout" json:"timeout"`
}

// Configuration represents all the api definitions
// 全部路由定义集合
type Configuration struct {
	Definitions []*Definition
}

// EqualsTo compares two configurations and determines if they are the same
func (c *Configuration) EqualsTo(c1 *Configuration) bool {
	return reflect.DeepEqual(c, c1)
}

// ConfigurationChanged is the message that is sent when a database configuration has changed
// 配置变更消息， 事件模型， 发布订阅
type ConfigurationChanged struct {
	Configurations *Configuration
}

// ConfigurationOperation is the available operations that a configuration can have
type ConfigurationOperation int

// ConfigurationMessage is used to notify listeners about something that happened with a configuration
type ConfigurationMessage struct {
	Operation     ConfigurationOperation
	Configuration *Definition
}

const (
	// RemovedOperation means a definition was removed
	RemovedOperation ConfigurationOperation = iota
	// UpdatedOperation means a definition was updated
	UpdatedOperation
	// AddedOperation means a definition was added
	AddedOperation
)

// NewDefinition creates a new API Definition with default values
func NewDefinition() *Definition {
	return &Definition{
		Active:  true,
		Plugins: make([]Plugin, 0),
		Proxy:   proxy.NewDefinition(),
	}
}

// Validate validates proxy data
func (d *Definition) Validate() (bool, error) {
	return govalidator.ValidateStruct(d)
}

// UnmarshalJSON api.Definition JSON.Unmarshaller implementation
// 如果直接在 `Definition` 类型上调用 `json.Unmarshal`，**会递归调用自身的 UnmarshalJSON，无限递归，栈溢出**；
func (d *Definition) UnmarshalJSON(b []byte) error {
	// Aliasing Definition to avoid recursive call of this method
	type definitionAlias Definition
	//这是**基于已有类型新建一个类型**，不是结构体嵌入。
	defAlias := definitionAlias(*NewDefinition())

	if err := json.Unmarshal(b, &defAlias); err != nil {
		return err
	}

	*d = Definition(defAlias)
	return nil
}

```
## pkg/proxy/definition.go
> `proxy.Definition` 定义一条路由的转发规则：监听路径、上游后端集群、负载均衡、超时、路径改写、host 处理、允许的 HTTP 方法、TLS 证书校验等。
搭配自定义`Duration`类型，用来**同时支持 JSON 和 MongoDB BSON 序列化 / 反序列化时间字符串**
```Go
package proxy

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/asaskevich/govalidator"
	"go.mongodb.org/mongo-driver/bson"
	"go.mongodb.org/mongo-driver/bson/bsontype"

	"github.com/hellofresh/janus/pkg/proxy/balancer"
	"github.com/hellofresh/janus/pkg/router"
)

// Definition defines proxy rules for a route
type Definition struct {
	PreserveHost       bool               `bson:"preserve_host" json:"preserve_host" mapstructure:"preserve_host"`
	ListenPath         string             `bson:"listen_path" json:"listen_path" mapstructure:"listen_path" valid:"required~proxy.listen_path is required,urlpath"`
	Upstreams          *Upstreams         `bson:"upstreams" json:"upstreams" mapstructure:"upstreams"`
	InsecureSkipVerify bool               `bson:"insecure_skip_verify" json:"insecure_skip_verify" mapstructure:"insecure_skip_verify"`
	StripPath          bool               `bson:"strip_path" json:"strip_path" mapstructure:"strip_path"`
	AppendPath         bool               `bson:"append_path" json:"append_path" mapstructure:"append_path"`
	Methods            []string           `bson:"methods" json:"methods"`
	Hosts              []string           `bson:"hosts" json:"hosts"`
	ForwardingTimeouts ForwardingTimeouts `bson:"forwarding_timeouts" json:"forwarding_timeouts" mapstructure:"forwarding_timeouts"`
}

// RouterDefinition represents an API that you want to proxy with internal router routines
// 运行时路由封装
type RouterDefinition struct {
	*Definition
	//中间件构造函数数组
	middleware []router.Constructor
}

// Upstreams represents a collection of targets where the requests will go to
type Upstreams struct {
	Balancing string  `bson:"balancing" json:"balancing"`
	Targets   Targets `bson:"targets" json:"targets"`
}

// Target is an ip address/hostname with a port that identifies an instance of a backend service
// 单个后端节点
type Target struct {
	Target string `bson:"target" json:"target" valid:"url,required"`
	Weight int    `bson:"weight" json:"weight"`
}

// Targets is a set of target
type Targets []*Target

// Duration is the time.Duration that can be unmarshalled from JSON
// 自定义时间类型
// Go原生time.Duration底层是int64, 直接序列化JSON会输出数字，不方便配置
// 自定义类型， 失效json 和 bson两套序列化接口
type Duration time.Duration

// MarshalJSON implements marshalling from JSON
// 结构体-> JSON字符串
func (d *Duration) MarshalJSON() ([]byte, error) {
	s := (*time.Duration)(d).String()
	s = strconv.Quote(s)

	return []byte(s), nil
}

// UnmarshalJSON implements unmarshalling from JSON
func (d *Duration) UnmarshalJSON(data []byte) (err error) {
	s := string(data)
	if s == "null" {
		return
	}

	// if Unquote returns error - assume that string is not quoted at all
	if sUnquoted, err := strconv.Unquote(s); err == nil {
		s = sUnquoted
	}
	//`time.ParseDuration` 解析`5s/300ms`这类时间字符串，转成 time.Duration
	t, err := time.ParseDuration(s)
	if err != nil {
		return
	}

	*d = Duration(t)
	return
}

// GetBSON implements marshalling to BSON
func (d Duration) GetBSON() (interface{}, error) {
	return time.Duration(d).String(), nil
}

// SetBSON implements unmarshalling from BSON
func (d *Duration) SetBSON(raw bson.RawValue) error {
	// took BSON string parsing logic from BSON decoder
	if raw.Type != bsontype.String {
		return fmt.Errorf("expected %q type, but got %q", bsontype.String.String(), raw.Type.String())
	}

	// l := d.readInt32()
	b := raw.Value[0:4]
	l := int32((uint32(b[0]) << 0) |
		(uint32(b[1]) << 8) |
		(uint32(b[2]) << 16) |
		(uint32(b[3]) << 24))

	// b := d.readBytes(l - 1)
	b = raw.Value[4 : 4+l-1]

	return d.UnmarshalJSON(b)
}

// ForwardingTimeouts contains timeout configurations for forwarding requests to the backend servers.
type ForwardingTimeouts struct {
	DialTimeout           Duration `bson:"dial_timeout" json:"dial_timeout"`
	ResponseHeaderTimeout Duration `bson:"response_header_timeout" json:"response_header_timeout"`
}

// NewDefinition creates a new Proxy Definition with default values
func NewDefinition() *Definition {
	return &Definition{
		Methods: []string{"GET"},
		Hosts:   make([]string, 0),
		Upstreams: &Upstreams{
			Targets: make([]*Target, 0),
		},
	}
}

// NewRouterDefinition creates a new Proxy RouterDefinition from Proxy Definition
func NewRouterDefinition(def *Definition) *RouterDefinition {
	return &RouterDefinition{Definition: def}
}

// Middleware returns s.middleware (useful for tests).
func (d *RouterDefinition) Middleware() []router.Constructor {
	return d.middleware
}

// AddMiddleware adds a middleware to a site's middleware stack.
func (d *RouterDefinition) AddMiddleware(m router.Constructor) {
	d.middleware = append(d.middleware, m)
}

// Validate validates proxy data
func (d *Definition) Validate() (bool, error) {
	return govalidator.ValidateStruct(d)
}

// IsBalancerDefined checks if load balancer is defined
// 判断这条代理路由是否配置了有效的上游后端节点
func (d *Definition) IsBalancerDefined() bool {
	return d.Upstreams != nil && d.Upstreams.Targets != nil && len(d.Upstreams.Targets) > 0
}

// ToBalancerTargets returns the balancer expected type
// 类型转换适配器
func (t Targets) ToBalancerTargets() []*balancer.Target {
	var balancerTargets []*balancer.Target
	for _, t := range t {
		balancerTargets = append(balancerTargets, &balancer.Target{
			Target: t.Target,
			Weight: t.Weight,
		})
	}

	return balancerTargets
}
func init() {
	// initializes custom validators
	govalidator.CustomTypeTagMap.Set("urlpath", func(i interface{}, o interface{}) bool {
		s, ok := i.(string)
		if !ok {
			return false
		}

		return strings.Index(s, "/") == 0
	})
}

```
## pkg/server/server.go
1. 网关启动、优雅关闭
2. HTTP 服务监听（HTTP/HTTPS，http 重定向 https）
3. 路由配置热更新（监听数据库变更、Admin Web API 变更）
4. 全局中间件挂载、插件事件分发（Startup / Reload）
5. 管理两套东西：**业务代理路由** + **Admin 管理 Web 服务**
```Go
package server

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi"
	"github.com/hellofresh/stats-go/client"
	log "github.com/sirupsen/logrus"
	"go.opencensus.io/plugin/ochttp/propagation/b3"

	"github.com/hellofresh/janus/pkg/api"
	"github.com/hellofresh/janus/pkg/config"
	"github.com/hellofresh/janus/pkg/errors"
	"github.com/hellofresh/janus/pkg/loader"
	"github.com/hellofresh/janus/pkg/middleware"
	"github.com/hellofresh/janus/pkg/plugin"
	"github.com/hellofresh/janus/pkg/proxy"
	"github.com/hellofresh/janus/pkg/router"
	"github.com/hellofresh/janus/pkg/web"
)

// Server is the Janus server
type Server struct {
	server                *http.Server                  // 网关主http.Server，处理用户业务请求
	provider              api.Repository                // 配置存储仓库（Mongo/Cassandra/file，读api.Definition）
	register              *proxy.Register               // 代理注册器，维护所有路由、http连接池、转发参数
	apiLoader             *loader.APILoader             // 路由加载器，把api.Definition翻译成路由+中间件
	currentConfigurations *api.Configuration            // 当前内存里全量路由配置
	configurationChan     chan api.ConfigurationChanged // 配置变更通知通道（数据库watcher推送）
	stopChan              chan struct{}                 // 停止信号
	globalConfig          *config.Specification         // 网关全局配置（前面config包）
	statsClient           client.Client                 // metrics指标上报
	webServer             *web.Server                   // Admin管理后台Web服务（8081，CRUD路由）
	profilingEnabled      bool                          // pprof开关
	profilingPublic       bool
}

// New creates a new instance of Server
// Option模式构造Server， 通道预初始化
func New(opts ...Option) *Server {
	s := Server{
		configurationChan: make(chan api.ConfigurationChanged, 100),
		stopChan:          make(chan struct{}, 1),
	}

	for _, opt := range opts {
		opt(&s)
	}

	return &s
}

// Start starts the server
func (s *Server) Start() error {
	return s.StartWithContext(context.Background())
}

// StartWithContext starts the server and Stop/Close it when context is Done
// ctx.Done 触发：收到 SIGINT/SIGTERM 信号，进入优雅退出流程。`GraceTimeOut`是等待存量请求处理完成的宽限期。
func (s *Server) StartWithContext(ctx context.Context) error {
	// goroutine：监听ctx取消，做优雅关闭
	go func() {
		defer s.Close()
		<-ctx.Done()
		log.Info("I have to go...")
		reqAcceptGraceTimeOut := time.Duration(s.globalConfig.GraceTimeOut)
		if reqAcceptGraceTimeOut > 0 {
			log.Infof("Waiting %s for incoming requests to cease", reqAcceptGraceTimeOut)
			time.Sleep(reqAcceptGraceTimeOut)
		}
		log.Info("Stopping server gracefully")
	}()

	// Register must be initialised synchronously to avoid race condition
	r := s.createRouter() // 创建根路由，挂载全局中间件
	s.register = proxy.NewRegister(
		proxy.WithRouter(r),
		proxy.WithFlushInterval(s.globalConfig.BackendFlushInterval),
		proxy.WithIdleConnectionsPerHost(s.globalConfig.MaxIdleConnsPerHost),
		proxy.WithIdleConnTimeout(s.globalConfig.IdleConnTimeout),
		proxy.WithIdleConnPurgeTicker(s.globalConfig.ConnPurgeInterval),
		proxy.WithStatsClient(s.statsClient),
		proxy.WithIsPublicEndpoint(s.globalConfig.Tracing.IsPublicEndpoint),
	)

	// API Loader must be initialised synchronously as well to avoid race condition
	s.apiLoader = loader.NewAPILoader(s.register)

	go func() {
		//启动主 HTTP/HTTPS 服务，接收业务流量
		if err := s.startHTTPServers(ctx, r); err != nil {
			log.WithError(err).Fatal("Could not start http servers")
		}
	}()
	//监听`configurationChan`，处理数据库推送的全量路由变更
	go s.listenProviders(s.stopChan)

	definitions, err := s.provider.FindAll()
	if err != nil {
		return fmt.Errorf("could not find all configurations from the provider: %w", err)
	}

	s.currentConfigurations = &api.Configuration{Definitions: definitions}
	if err := s.startProvider(ctx); err != nil {
		log.WithError(err).Fatal("Could not start providers")
	}
	//从 DB 一次性 Load 全部路由，作为内存基准配置
	event := plugin.OnStartup{
		StatsClient:   s.statsClient,
		Register:      s.register,
		Config:        s.globalConfig,
		Configuration: definitions,
	}

	if mgoRepo, ok := s.provider.(*api.MongoRepository); ok {
		event.MongoDB = mgoRepo.DB
	}

	if cassRepo, ok := s.provider.(*api.CassandraRepository); ok {
		event.Cassandra = cassRepo.Session
	}

	plugin.EmitEvent(plugin.StartupEvent, event)
	s.apiLoader.RegisterAPIs(definitions)

	log.Info("Janus started")

	return nil
}

// Wait blocks until server is shut down.
func (s *Server) Wait() {
	<-s.stopChan
}

// Stop stops the server
func (s *Server) Stop() {
	defer log.Info("Server stopped")

	graceTimeOut := time.Duration(s.globalConfig.GraceTimeOut)
	ctx, cancel := context.WithTimeout(context.Background(), graceTimeOut)
	defer cancel()
	log.Debugf("Waiting %s seconds before killing connections...", graceTimeOut)
	if err := s.server.Shutdown(ctx); err != nil {
		log.WithError(err).Debug("Wait is over due to error")
		s.server.Close()
	}
	log.Debug("Server closed")

	s.stopChan <- struct{}{}
}

// Close closes the server
func (s *Server) Close() error {
	defer close(s.stopChan)
	defer close(s.configurationChan)
	defer s.webServer.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	go func(ctx context.Context) {
		<-ctx.Done()
		if ctx.Err() == context.Canceled {
			return
		} else if ctx.Err() == context.DeadlineExceeded {
			panic("Timeout while stopping janus, killing instance ✝")
		}
	}(ctx)

	return s.server.Close()
}

func (s *Server) startHTTPServers(ctx context.Context, r router.Router) error {
	return s.listenAndServe(chi.ServerBaseContext(ctx, r))
}

// 启动 Admin Web 服务 + 监听单条路由变更
func (s *Server) startProvider(ctx context.Context) error {
	s.webServer = web.New(
		web.WithConfigurations(s.currentConfigurations),
		web.WithPort(s.globalConfig.Web.Port),
		web.WithTLS(s.globalConfig.Web.TLS),
		web.WithCredentials(s.globalConfig.Web.Credentials),
		web.WithProfiler(s.profilingEnabled, s.profilingPublic),
	)

	if err := s.webServer.Start(); err != nil {
		return fmt.Errorf("could not start Janus web API: %w", err)
	}

	// We're listening to the configuration changes in any case, even if provider does not implement Listener,
	// so we can use "file" storage as memory - all the persistent definitions are loaded on startup,
	// but then API allows to manipulate proxies in memory. Otherwise api calls just stuck because channel is busy.
	go func() {
		ch := make(chan api.ConfigurationMessage)
		listener, providerIsListener := s.provider.(api.Listener)
		if providerIsListener {
			listener.Listen(ctx, ch)
		}

		for {
			select {
			case c, more := <-s.webServer.ConfigurationChan:
				if !more {
					return
				}
				// Admin接口新增/修改/删除单条路由，触发单条变更
				s.updateConfigurations(c)              // 更新内存currentConfigurations
				s.handleEvent(s.currentConfigurations) // 热加载路由

				if providerIsListener {
					ch <- c
				}
			case <-ctx.Done():
				close(ch)
				return
			}
		}
	}()

	if watcher, ok := s.provider.(api.Watcher); ok {
		watcher.Watch(ctx, s.configurationChan)
	}

	return nil
}

// 监听数据库推送的【全量配置变更】
func (s *Server) listenProviders(stop chan struct{}) {
	for {
		select {
		case <-stop:
			return
		case configMsg, ok := <-s.configurationChan:
			if !ok {
				return
			}
			// 深度对比新旧配置，相同直接跳过，不做无意义重载
			if s.currentConfigurations.EqualsTo(configMsg.Configurations) {
				log.Debug("Skipping same configuration")
				continue
			}

			s.currentConfigurations.Definitions = configMsg.Configurations.Definitions
			s.handleEvent(configMsg.Configurations)
		}
	}
}

// 启动 http.Server，支持 HTTP / HTTPS + http 强制跳转 https
func (s *Server) listenAndServe(handler http.Handler) error {
	address := fmt.Sprintf(":%v", s.globalConfig.Port)
	logger := log.WithField("address", address)
	s.server = &http.Server{
		Addr:         address,
		Handler:      handler,
		ReadTimeout:  s.globalConfig.RespondingTimeouts.ReadTimeout,
		WriteTimeout: s.globalConfig.RespondingTimeouts.WriteTimeout,
		IdleTimeout:  s.globalConfig.RespondingTimeouts.IdleTimeout,
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return fmt.Errorf("error opening listener: %w", err)
	}

	if s.globalConfig.TLS.IsHTTPS() {
		s.server.Addr = fmt.Sprintf(":%v", s.globalConfig.TLS.Port)

		if s.globalConfig.TLS.Redirect {
			go func() {
				logger.Info("Listening HTTP redirects to HTTPS")
				log.Fatal(http.Serve(listener, web.RedirectHTTPS(s.globalConfig.TLS.Port)))
			}()
		}

		logger.Info("Listening HTTPS")
		return s.server.ServeTLS(listener, s.globalConfig.TLS.CertFile, s.globalConfig.TLS.KeyFile)
	}

	logger.Info("Certificate and certificate key were not found, defaulting to HTTP")
	return s.server.Serve(listener)
}

// 创建全局根路由 + 全局中间件
func (s *Server) createRouter() router.Router {
	// create router with a custom not found handler
	router.DefaultOptions.NotFoundHandler = errors.NotFound
	r := router.NewChiRouterWithOptions(router.DefaultOptions)

	// Add RequestID middleware first if enabled, so we could use it in other middlewares, e.g. logger
	if s.globalConfig.RequestID {
		r.Use(middleware.RequestID)
	}

	// Add DebugTraceKey middleware which returns debug header with the Trace ID
	if s.globalConfig.Tracing.DebugTraceKey != "" {
		r.Use(middleware.DebugTrace(&b3.HTTPFormat{}, s.globalConfig.Tracing.DebugTraceKey))
	}

	r.Use(
		middleware.NewStats(s.statsClient).Handler,
		middleware.NewLogger().Handler,
		middleware.NewRecovery(errors.RecoveryHandler),
	)

	// some routers may panic when have empty routes list, so add one dummy 404 route to avoid this
	if r.RoutesCount() < 1 {
		r.Any("/", errors.NotFound)
	}

	return r
}

// 单条路由增删改（Admin 接口用）
func (s *Server) updateConfigurations(cfg api.ConfigurationMessage) {
	currentDefinitions := s.currentConfigurations.Definitions

	switch cfg.Operation {
	case api.AddedOperation:
		currentDefinitions = append(currentDefinitions, cfg.Configuration)
	case api.UpdatedOperation:
		// 根据name找到路由覆盖
		for i, d := range currentDefinitions {
			if d.Name == cfg.Configuration.Name {
				currentDefinitions[i] = cfg.Configuration
			}
		}
	case api.RemovedOperation:
		// 删除：拷贝覆盖，切片截断
		for i, d := range currentDefinitions {
			if d.Name == cfg.Configuration.Name {
				copy(currentDefinitions[i:], currentDefinitions[i+1:])
				// currentDefinitions[len(currentDefinitions)-1] = nil // or the zero value of T
				currentDefinitions = currentDefinitions[:len(currentDefinitions)-1]
			}
		}
	}

	s.currentConfigurations.Definitions = currentDefinitions
}

// 路由热更新核心函数
func (s *Server) handleEvent(cfg *api.Configuration) {
	log.Debug("Refreshing configuration")
	newRouter := s.createRouter()

	s.register.UpdateRouter(newRouter)
	s.apiLoader.RegisterAPIs(cfg.Definitions)

	plugin.EmitEvent(plugin.ReloadEvent, plugin.OnReload{Configurations: cfg.Definitions})

	s.server.Handler = newRouter
	log.Debug("Configuration refresh done")
}

```
## pkg/loader/api_loader.go
> 负责**把 api.Definition（一条完整路由配置，包含代理配置 + 插件列表）转换成运行时路由 RouterDefinition，加载插件、挂载路由级中间件，最后交给 proxy.Register 注册进网关路由表**。
```Go
package loader

import (
	"github.com/hellofresh/janus/pkg/api"
	"github.com/hellofresh/janus/pkg/middleware"
	obs "github.com/hellofresh/janus/pkg/observability"
	"github.com/hellofresh/janus/pkg/plugin"
	"github.com/hellofresh/janus/pkg/proxy"
	log "github.com/sirupsen/logrus"
	"go.opencensus.io/tag"
)

// APILoader is responsible for loading all apis form a datastore and configure them in a register
type APILoader struct {
	register *proxy.Register
}

// NewAPILoader creates a new instance of the api manager
func NewAPILoader(register *proxy.Register) *APILoader {
	return &APILoader{register: register}
}

// RegisterAPIs load application middleware
func (m *APILoader) RegisterAPIs(cfgs []*api.Definition) {
	for _, spec := range cfgs {
		m.RegisterAPI(spec)
	}
}

// RegisterAPI register an API Definition in the register
// RegisterAPI 单条路由注册核心
func (m *APILoader) RegisterAPI(def *api.Definition) {
	logger := log.WithField("api_name", def.Name)
	logger.Debug("Starting RegisterAPI")

	active, err := def.Validate()
	if false == active && err != nil {
		logger.WithError(err).Error("Validation errors")
	}

	if false == def.Active {
		logger.Warn("API is not active, skipping...")
		active = false
	}

	if active {
		routerDefinition := proxy.NewRouterDefinition(def.Proxy)
		// 遍历插件
		for _, plg := range def.Plugins {
			l := logger.WithField("name", plg.Name)

			isValid, err := plugin.ValidateConfig(plg.Name, plg.Config)
			if !isValid || err != nil {
				l.WithError(err).Error("Plugin configuration is invalid")
			}

			if plg.Enabled {
				l.Debug("Plugin enabled")
				//执行插件初始化
				setup, err := plugin.DirectiveAction(plg.Name)
				if err != nil {
					l.WithError(err).Error("Error loading plugin")
					continue
				}

				err = setup(routerDefinition, plg.Config)
				if err != nil {
					l.WithError(err).Error("Error executing plugin")
				}
			} else {
				l.Debug("Plugin not enabled")
			}
		}

		if len(def.Proxy.Hosts) > 0 {
			routerDefinition.AddMiddleware(middleware.NewHostMatcher(def.Proxy.Hosts).Handler)
		}

		// Add middleware to insert tags to context
		tags := []tag.Mutator{
			tag.Insert(obs.KeyListenPath, def.Proxy.ListenPath),
		}
		routerDefinition.AddMiddleware(middleware.NewStatsTagger(tags).Handler)

		m.register.Add(routerDefinition)
		logger.Debug("API registered")
	} else {
		logger.WithError(err).Warn("API URI is invalid or not active, skipping...")
	}
}

```
## pkg/proxy/register.go
> **路由注册器**，接收 loader 传过来的 `RouterDefinition`，做几件核心事：
1. 创建负载均衡实例 balancer
2. 构建反向代理 handler + 底层 transport（连接池、转发超时、TLS 跳过证书校验）
3. 把【listenPath + HTTP 方法 + 路由中间件 + 代理 handler】注册到 router（chi）
```Go
package proxy

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/hellofresh/stats-go/client"
	log "github.com/sirupsen/logrus"
	"go.opencensus.io/plugin/ochttp"

	"github.com/hellofresh/janus/pkg/proxy/balancer"
	"github.com/hellofresh/janus/pkg/proxy/transport"
	"github.com/hellofresh/janus/pkg/router"
)

const (
	methodAll = "ALL"
)
loader.RegisterAPI
	└── register.Add(routerDefinition)
			├ balancer.New 创建负载均衡器
			├ NewBalancedReverseProxy 创建反向代理handler
			├ 构建transport（独立连接池、超时、TLS、trace）
			└ doRegister
					└ router.Any / router.Handle
						注册路径 + 方法 + 路由中间件 + proxy handler

// Register handles the register of proxies into the chosen router.
// It also handles the conversion from a proxy to an http.HandlerFunc
type Register struct {
	router                 router.Router             // 根路由（chi包装），保存所有注册的路由
	idleConnectionsPerHost int                       // 每个上游host最大空闲连接
	idleConnTimeout        time.Duration             // 空闲连接超时
	idleConnPurgeTicker    *time.Ticker              // 定时清理过期空闲连接
	flushInterval          time.Duration             // 代理response body flush间隔（流式返回）
	statsClient            client.Client             // metrics上报
	matcher                *router.ListenPathMatcher // 路径匹配器，处理路径前缀匹配
	isPublicEndpoint       bool                      // trace标记，是否公网端点（opencensus链路追踪）
}

// NewRegister creates a new instance of Register
func NewRegister(opts ...RegisterOption) *Register {
	r := Register{
		matcher: router.NewListenPathMatcher(),
	}

	for _, opt := range opts {
		opt(&r)
	}

	return &r
}

// UpdateRouter updates the reference to the router. This is useful to reload the mux
func (p *Register) UpdateRouter(router router.Router) {
	p.router = router
}

// Add register a new route
// 添加一条路由
func (p *Register) Add(definition *RouterDefinition) error {
	log.WithField("balancing_alg", definition.Upstreams.Balancing).Debug("Using a load balancing algorithm")
	balancerInstance, err := balancer.New(definition.Upstreams.Balancing)
	if err != nil {
		log.WithError(err).Error("Could not create a balancer")
		return fmt.Errorf("could not create a balancer: %w", err)
	}
	// 创建带负载均衡的反向代理Handler
	handler := NewBalancedReverseProxy(definition.Definition, balancerInstance, p.statsClient)
	handler.FlushInterval = p.flushInterval
	handler.Transport = &ochttp.Transport{
		Base: transport.New(
			transport.WithIdleConnTimeout(p.idleConnTimeout),
			transport.WithIdleConnPurgeTicker(p.idleConnPurgeTicker),
			transport.WithInsecureSkipVerify(definition.InsecureSkipVerify),
			transport.WithDialTimeout(time.Duration(definition.ForwardingTimeouts.DialTimeout)),
			transport.WithResponseHeaderTimeout(time.Duration(definition.ForwardingTimeouts.ResponseHeaderTimeout)),
		),
	}
	//每个路由拥有独立 Transport 和独立连接池，路由之间连接池隔离，一条路由上游故障不会吃掉所有连接
	if p.matcher.Match(definition.ListenPath) {
		p.doRegister(p.matcher.Extract(definition.ListenPath), definition, &ochttp.Handler{Handler: handler, IsPublicEndpoint: p.isPublicEndpoint})
	}

	p.doRegister(definition.ListenPath, definition, &ochttp.Handler{Handler: handler, IsPublicEndpoint: p.isPublicEndpoint})
	return nil
}

// 真正注册路由到 chi router
func (p *Register) doRegister(listenPath string, def *RouterDefinition, handler http.Handler) {
	log.WithFields(log.Fields{
		"listen_path": listenPath,
	}).Debug("Registering a route")

	if strings.Index(listenPath, "/") != 0 {
		log.WithField("listen_path", listenPath).
			Error("Route listen path must begin with '/'. Skipping invalid route.")
	} else {
		for _, method := range def.Methods {
			if strings.ToUpper(method) == methodAll {
				p.router.Any(listenPath, handler.ServeHTTP, def.middleware...)
			} else {
				p.router.Handle(strings.ToUpper(method), listenPath, handler.ServeHTTP, def.middleware...)
			}
		}
	}
}

```
## pkg/proxy/reverse_proxy.go
> `httputil.ReverseProxy` 的灵魂就是 `Director` 函数：**每来一条请求，执行一次 Director，修改 request，组装上游 url、path、query、host**。
```Go
package proxy

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"github.com/go-chi/chi"
	"github.com/hellofresh/stats-go/bucket"
	"github.com/hellofresh/stats-go/client"
	log "github.com/sirupsen/logrus"
	"go.opencensus.io/tag"
	"go.opencensus.io/trace"

	"github.com/hellofresh/janus/pkg/observability"
	"github.com/hellofresh/janus/pkg/proxy/balancer"
	"github.com/hellofresh/janus/pkg/router"
)

const (
	statsSection = "upstream"
)

// NewBalancedReverseProxy creates a reverse proxy that is load balanced
func NewBalancedReverseProxy(def *Definition, balancer balancer.Balancer, statsClient client.Client) *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Director: createDirector(def, balancer, statsClient),
	}
}

// 最重要的 Director 闭包（每请求执行一次）
func createDirector(proxyDefinition *Definition, balancer balancer.Balancer, statsClient client.Client) func(req *http.Request) {
	paramNameExtractor := router.NewListenPathParamNameExtractor()
	matcher := router.NewListenPathMatcher()

	return func(req *http.Request) {
		// 负载均衡选出上游节点
		upstream, err := balancer.Elect(proxyDefinition.Upstreams.Targets.ToBalancerTargets())
		if err != nil {
			log.WithError(err).Error("Could not elect one upstream")
			return
		}

		targetURL := upstream.Target
		//路径参数替换（模板路由，如 `/users/{id}`）
		paramNames := paramNameExtractor.Extract(targetURL)
		parametrizedPath, err := applyParameters(req, targetURL, paramNames)
		if err != nil {
			log.WithError(err).Warn("Unable to extract param from request")
		} else {
			targetURL = parametrizedPath
		}

		log.WithField("target", targetURL).Debug("Target upstream elected")

		target, err := url.Parse(targetURL)
		if err != nil {
			log.WithError(err).WithField("upstream_url", targetURL).Error("Could not parse the target URL")
			return
		}

		originalURI := req.RequestURI
		targetQuery := target.RawQuery
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		path := target.Path

		if proxyDefinition.AppendPath {
			log.Debug("Appending listen path to the target url")
			path = singleJoiningSlash(target.Path, req.URL.Path)
		}

		if proxyDefinition.StripPath {
			path = singleJoiningSlash(target.Path, req.URL.Path)
			listenPath := matcher.Extract(proxyDefinition.ListenPath)

			log.WithField("listen_path", listenPath).Debug("Stripping listen path")
			if len(paramNames) > 0 {
				path = stripPathWithParams(req, path, listenPath, paramNames)
			} else {
				path = strings.Replace(path, listenPath, "", 1)
			}
			if !strings.HasSuffix(target.Path, "/") && strings.HasSuffix(path, "/") {
				path = path[:len(path)-1]
			}
		}

		log.WithField("path", path).Debug("Upstream Path")
		req.URL.Path = path

		// This is very important to avoid problems with ssl verification for the HOST header
		if proxyDefinition.PreserveHost {
			log.Debug("Preserving the host header")
		} else {
			req.Host = target.Host
		}

		if targetQuery == "" || req.URL.RawQuery == "" {
			req.URL.RawQuery = targetQuery + req.URL.RawQuery
		} else {
			req.URL.RawQuery = targetQuery + "&" + req.URL.RawQuery
		}

		// Since director modifies cloned request there is no way (or I just did not find one)
		// to get upstream from logger middleware, so we're logging original request and upstream here
		// with the same logging level. Original request is here to match two log messages in case
		// RequestID is not enabled.
		log.WithFields(log.Fields{
			"request":          originalURI,
			"request-id":       observability.RequestIDFromContext(req.Context()),
			"upstream-host":    req.URL.Host,
			"upstream-request": req.URL.RequestURI(),
		}).Info("Proxying request to the following upstream")

		statsClient.TrackMetric(statsSection, bucket.MetricOperation{req.Host})

		// Add additional trace attributes
		addTraceAttributes(req)

		// Insert additional tags
		ctx, _ := tag.New(req.Context(), tag.Insert(observability.KeyUpstreamPath, upstream.Target))
		*req = *req.WithContext(ctx)
	}
}

func addTraceAttributes(req *http.Request) {
	ctx := req.Context()
	span := trace.FromContext(ctx)
	if span == nil {
		return
	}

	host, err := os.Hostname()
	if host == "" || err != nil {
		log.WithError(err).Debug("Failed to get host name")
		host = "unknown"
	}

	span.AddAttributes(
		trace.StringAttribute("http.host", host),
		trace.StringAttribute("http.referrer", req.Referer()),
		trace.StringAttribute("http.remote_address", req.RemoteAddr),
		trace.StringAttribute("request.id", observability.RequestIDFromContext(ctx)),
	)
}

// 路径模板参数替换
func applyParameters(req *http.Request, path string, paramNames []string) (string, error) {
	for _, paramName := range paramNames {
		paramValue := chi.URLParam(req, paramName)

		if len(paramValue) == 0 {
			return "", fmt.Errorf("unable to extract {%s} from request", paramName)
		}

		path = strings.Replace(
			path,
			fmt.Sprintf("{%s}", paramName),
			paramValue,
			-1,
		)
	}

	return path, nil
}

func singleJoiningSlash(a, b string) string {
	a = cleanSlashes(a)
	b = cleanSlashes(b)

	aSlash := strings.HasSuffix(a, "/")
	bSlash := strings.HasPrefix(b, "/")

	switch {
	case aSlash && bSlash:
		return a + b[1:]
	case !aSlash && !bSlash:
		if len(b) > 0 {
			return a + "/" + b
		}
		return a
	}
	return a + b
}

func cleanSlashes(a string) string {
	endSlash := strings.HasSuffix(a, "//")
	startSlash := strings.HasPrefix(a, "//")

	if startSlash {
		a = "/" + strings.TrimPrefix(a, "//")
	}

	if endSlash {
		a = strings.TrimSuffix(a, "//") + "/"
	}

	return a
}

// chiURLParam is created to allow for mocking of the chi.URLParam function.
// This allowed for writing a quick unit test to check that the logic of the function works without having to deal with chi's context requirements.
var chiURLParam = chi.URLParam

// stripPathWithParams is intended to properly strip the listen path from the requested path when named parameters are used.
// From left to right, it removes the first instance of each section of the listenPath and each paramName from the path.
func stripPathWithParams(req *http.Request, path string, listenPath string, paramNames []string) string {
	remove := strings.Split(listenPath, "/")
	for i := 0; i < len(paramNames); i++ {
		remove = append(remove, chiURLParam(req, paramNames[i]))
	}
	for i := 1; i < len(remove); i++ {
		path = strings.Replace(path, "/"+remove[i], "", 1)
	}
	return path
}

```

## pkg/plugin/plugin.go
> 实现了**插件注册、配置校验、获取插件 Setup 函数、事件钩子 EventHook**这套插件框架。
```Go
package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/hellofresh/janus/pkg/proxy"
	log "github.com/sirupsen/logrus"
)

var (
	lock sync.RWMutex

	// plugins is a map of plugin name to Plugin.
	// key:插件名，value:Plugin结构体
	plugins = make(map[string]Plugin)

	// eventHooks is a map of hook name to Hook. All hooks plugins
	// must have a name.
	// key:事件名，value:同一事件的多个钩子数组
	eventHooks = make(map[string][]EventHook)
)

// SetupFunc is used to set up a plugin, or in other words,
// execute a directive. It will be called once per key for
// each server block it appears in.
type SetupFunc func(def *proxy.RouterDefinition, rawConfig Config) error

// ValidateFunc validates configuration data against the plugin struct
type ValidateFunc func(rawConfig Config) (bool, error)

// Config initialization options.
type Config map[string]interface{}

// Plugin defines basic methods for plugins
type Plugin struct {
	Action   SetupFunc
	Validate ValidateFunc
}

// RegisterPlugin plugs in plugin. All plugins should register
// themselves, even if they do not perform an action associated
// with a directive. It is important for the process to know
// which plugins are available.
//
// The plugin MUST have a name: lower case and one word.
// If this plugin has an action, it must be the name of
// the directive that invokes it. A name is always required
// and must be unique for the server type.
// 注册插件
func RegisterPlugin(name string, plugin Plugin) error {
	lock.Lock()
	defer lock.Unlock()

	if name == "" {
		return errors.New("plugin must have a name")
	}
	if _, dup := plugins[name]; dup {
		return fmt.Errorf("plugin named %q already registered", name)
	}
	plugins[name] = plugin
	return nil
}

// EventHook is a type which holds information about a startup hook plugin.
type EventHook func(event interface{}) error

// RegisterEventHook plugs in hook. All the hooks should register themselves
// and they must have a name.
// 注册事件钩子
func RegisterEventHook(name string, hook EventHook) error {
	log.WithField("event_name", name).Debug("Event registered")
	lock.Lock()
	defer lock.Unlock()

	if name == "" {
		return errors.New("event hook must have a name")
	}

	if hooks, dup := eventHooks[name]; dup {
		eventHooks[name] = append(hooks, hook)
	} else {
		eventHooks[name] = append([]EventHook{}, hook)
	}

	return nil
}

// EmitEvent executes the different hooks passing the EventType as an
// argument. This is a blocking function. Hook developers should
// use 'go' keyword if they don't want to block Janus.
func EmitEvent(name string, event interface{}) error {
	log.WithField("event_name", name).Debug("Event triggered")

	hooks, found := eventHooks[name]
	if !found {
		return fmt.Errorf("plugin for event %q not found", name)
	}

	for _, hook := range hooks {
		err := hook(event)
		if err != nil {
			log.WithError(err).WithField("event_name", name).Warn("an error occurred when an event was triggered")
		}
	}

	return nil
}

// ValidateConfig validates the plugin configuration data
func ValidateConfig(name string, rawConfig Config) (bool, error) {
	logger := log.WithField("plugin_name", name)

	if plugin, ok := plugins[name]; ok {
		if plugin.Validate == nil {
			logger.Debug("Validation function undefined; assuming valid configuration")
			return true, nil
		}

		result, err := plugin.Validate(rawConfig)
		if !result || err != nil {
			logger.WithField("config", rawConfig).Info("Invalid plugin configuration")
		}

		return result, err
	}

	return false, fmt.Errorf("plugin %q not found", name)
}

// DirectiveAction gets the action for a plugin
// 获取插件 Setup 函数
func DirectiveAction(name string) (SetupFunc, error) {
	if plugin, ok := plugins[name]; ok {
		if plugin.Action == nil {
			return nil, fmt.Errorf("action function undefined for plugin %q", name)
		}

		return plugin.Action, nil
	}

	return nil, fmt.Errorf("plugin %q not found", name)
}

// Decode decodes a map string interface into a struct
// for some reasons mapstructure.Decode() gives empty arrays for all resulting config fields
// this is quick workaround hack t make it work
// FIXME: investigate and fix mapstructure.Decode() behaviour and remove this dirty hack
// map → json.Marshal → json.Unmarshal 到目标结构体
func Decode(rawConfig map[string]interface{}, obj interface{}) error {
	valJSON, err := json.Marshal(rawConfig)
	if nil != err {
		return err
	}

	err = json.Unmarshal(valJSON, obj)
	if nil != err {
		return err
	}

	return nil
}

```
## pkg/plugin/rate/setup.go
> **rate_limit 限流插件完整源码**，基于 `ulule/limiter` 库实现，支持两种策略：
1. `local`：内存限流（单机）
2. `redis`：分布式限流（多网关节点共享计数器）
在路由加载阶段（`setupRateLimit`）注册限流中间件；利用插件系统的 `init()` 完成注册，同时监听网关 Startup 事件拿到 stats 埋点客户端。
```Go
package rate

import (
	"net/http"
	"time"

	"github.com/asaskevich/govalidator"
	"github.com/go-redis/redis/v7"
	"github.com/hellofresh/stats-go/client"
	"github.com/ulule/limiter/v3"
	"github.com/ulule/limiter/v3/drivers/middleware/stdlib"
	storeMemory "github.com/ulule/limiter/v3/drivers/store/memory"
	storeRedis "github.com/ulule/limiter/v3/drivers/store/redis"

	"github.com/hellofresh/janus/pkg/errors"
	"github.com/hellofresh/janus/pkg/plugin"
	"github.com/hellofresh/janus/pkg/proxy"
)

var (
	statsClient client.Client
	// ErrInvalidPolicy is used when an invalid policy was provided
	ErrInvalidPolicy = errors.New(http.StatusBadRequest, "policy is not supported")
)

const (
	// DefaultPrefix is the default prefix to use for the key in the store.
	DefaultPrefix = "limiter"
)

// Config represents a rate limit config
type Config struct {
	Limit               string      `json:"limit"`  //限流规则字符串
	Policy              string      `json:"policy"` //`local`单机内存 / `redis`分布式
	RedisConfig         redisConfig `json:"redis"`
	TrustForwardHeaders bool        `json:"trust_forward_headers"` //：是否信任 X-Forwarded-*，用来从 header 拿真实客户端 IP
}

type redisConfig struct {
	DSN    string `json:"dsn"`
	Prefix string `json:"prefix"`
}

func init() {
	plugin.RegisterEventHook(plugin.StartupEvent, onStartup)
	plugin.RegisterPlugin("rate_limit", plugin.Plugin{
		Action:   setupRateLimit,
		Validate: validateConfig,
	})
}

// 启动事件回调
func onStartup(event interface{}) error {
	e, ok := event.(plugin.OnStartup)
	if !ok {
		return errors.New(http.StatusInternalServerError, "Could not convert event to startup type")
	}

	statsClient = e.StatsClient
	return nil
}

// 配置校验函数
func validateConfig(rawConfig plugin.Config) (bool, error) {
	var config Config
	err := plugin.Decode(rawConfig, &config)
	if err != nil {
		return false, err
	}

	return govalidator.ValidateStruct(config)
}

// 插件安装函数
func setupRateLimit(def *proxy.RouterDefinition, rawConfig plugin.Config) error {
	var config Config
	err := plugin.Decode(rawConfig, &config)
	if err != nil {
		return err
	}

	rate, err := limiter.NewRateFromFormatted(config.Limit)
	if err != nil {
		return err
	}

	limiterStore, err := getLimiterStore(config.Policy, config.RedisConfig)
	if err != nil {
		return err
	}

	limiterInstance := limiter.New(limiterStore, rate, limiter.WithTrustForwardHeader(config.TrustForwardHeaders))
	def.AddMiddleware(NewRateLimitLogger(limiterInstance, statsClient, config.TrustForwardHeaders))
	def.AddMiddleware(stdlib.NewMiddleware(limiterInstance).Handler)

	return nil
}

func getLimiterStore(policy string, config redisConfig) (limiter.Store, error) {
	switch policy {
	case "redis":
		option, err := redis.ParseURL(config.DSN)
		if err != nil {
			return nil, err
		}
		option.PoolSize = 3
		option.IdleTimeout = 240 * time.Second
		redisClient := redis.NewClient(option)

		if config.Prefix == "" {
			config.Prefix = DefaultPrefix
		}

		return storeRedis.NewStoreWithOptions(redisClient, limiter.StoreOptions{
			Prefix:   config.Prefix,
			MaxRetry: limiter.DefaultMaxRetry,
		})

	case "local":
		return storeMemory.NewStore(), nil

	default:
		return nil, ErrInvalidPolicy
	}
}

```
## pkg/api/repository.go
> Janus 网关**配置仓库工厂模块（api 包）**，核心职责：根据传入 DSN 的 `scheme`，自动选择不同配置存储后端，创建**路由配置仓库 Repository**。
> 支持 3 种配置源：`mongodb` / `cassandra` / `file本地文件`，同时定义了配置变更监听相关接口 `Watcher`、`Listener`，支撑**配置热重载**。
```Go
package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"time"

	log "github.com/sirupsen/logrus"
)

const (
	mongodb   = "mongodb"
	cassandra = "cassandra"
	file      = "file"
)

// Repository defines the behavior of a proxy specs repository
type Repository interface {
	//关闭数据库连接、文件句柄等资源
	io.Closer
	//**一次性加载全部路由配置**（所有 API 路由 / 插件配置）
	FindAll() ([]*Definition, error)
}

// Watcher defines how a provider should watch for changes on configurations
// 配置源【主动推送变更】，watch监听，有变化就往通道发送变更事件
type Watcher interface {
	Watch(ctx context.Context, cfgChan chan<- ConfigurationChanged)
}

// Listener defines how a provider should listen for changes on configurations
// 消费配置变更消息，从通道读取变更事件，执行配置重新加载
type Listener interface {
	Listen(ctx context.Context, cfgChan <-chan ConfigurationMessage)
}

// BuildRepository creates a repository instance that will depend on your given DSN
func BuildRepository(dsn string, refreshTime time.Duration) (Repository, error) {
	dsnURL, err := url.Parse(dsn)
	if err != nil {
		return nil, fmt.Errorf("error parsing the DSN: %w", err)
	}

	switch dsnURL.Scheme {
	case mongodb:
		log.Debug("MongoDB configuration chosen")
		return NewMongoAppRepository(dsn, refreshTime)
	case cassandra:
		log.Debugf("Casssandra configuration chosen: dsn is %s, dsnURL is %s", dsnURL.Path, dsnURL)
		return NewCassandraRepository(dsnURL.Path, refreshTime)
	case file:
		log.Debug("File system based configuration chosen")
		apiPath := fmt.Sprintf("%s/apis", dsnURL.Path)

		log.WithField("path", apiPath).Debug("Trying to load API configuration files")
		repo, err := NewFileSystemRepository(apiPath)
		if err != nil {
			return nil, fmt.Errorf("could not create a file system repository: %w", err)
		}
		return repo, nil
	default:
		return nil, errors.New("selected scheme is not supported to load API definitions")
	}
}

```
## pkg/web/provider.go
> Janus 网关 **Admin 管理后台服务（web 包）**，独立于**业务流量代理服务**，提供一套管理 API
- 查看 / 增删改查网关路由配置（`/apis`）
- 登录、刷新 token（JWT 鉴权）
- 健康状态、Prometheus 指标 `/metrics`
- pprof 性能分析接口（可选开启）
- 修改配置后通过 `ConfigurationChan` 通知网关主流程**热重载路由**
```Go
package web

import (
	"fmt"
	"net/http"
	"net/http/pprof"

	chiMiddleware "github.com/go-chi/chi/middleware"
	"github.com/hellofresh/janus/pkg/api"
	"github.com/hellofresh/janus/pkg/config"
	httpErrors "github.com/hellofresh/janus/pkg/errors"
	"github.com/hellofresh/janus/pkg/jwt"
	"github.com/hellofresh/janus/pkg/middleware"
	obs "github.com/hellofresh/janus/pkg/observability"
	"github.com/hellofresh/janus/pkg/plugin"
	"github.com/hellofresh/janus/pkg/router"
	"github.com/rs/cors"
	log "github.com/sirupsen/logrus"
)

// Server represents the web server
type Server struct {
	Port              int                           // admin端口
	Credentials       config.Credentials            // admin账号密码，用于登录
	TLS               config.TLS                    // admin是否开启HTTPS
	ConfigurationChan chan api.ConfigurationMessage // 配置变更通道：admin收到配置修改，往这个channel发消息，通知主网关重载
	apiHandler        *APIHandler                   // 路由配置CRUD handler
	profilingEnabled  bool                          // 是否开启pprof
	profilingPublic   bool                          // pprof是否免鉴权
}

// New creates a new web server
func New(opts ...Option) *Server {
	cfgChan := make(chan api.ConfigurationMessage)
	s := Server{
		ConfigurationChan: cfgChan,
		apiHandler:        NewAPIHandler(cfgChan),
	}

	for _, opt := range opts {
		opt(&s)
	}

	return &s
}

// Start creates a router and serves requests async
func (s *Server) Start() error {
	log.Info("Janus Admin API starting...")
	router.DefaultOptions.NotFoundHandler = httpErrors.NotFound
	r := router.NewChiRouterWithOptions(router.DefaultOptions)
	go s.listenAndServe(r)

	s.AddRoutes(r)
	plugin.EmitEvent(plugin.AdminAPIStartupEvent, plugin.OnAdminAPIStartup{Router: r})

	return nil
}

// Stop stops the server
func (s *Server) Stop() {
	close(s.ConfigurationChan)
}

// AddRoutes adds the admin routes
// 全局中间件 + 路由分组
func (s *Server) AddRoutes(r router.Router) {
	guard := jwt.NewGuard(s.Credentials)
	r.Use(
		chiMiddleware.StripSlashes,      // 自动去除路径末尾多余/，/apis/ 和 /apis 等价
		chiMiddleware.DefaultCompress,   // gzip压缩响应
		middleware.NewLogger().Handler,   // 访问日志
		middleware.NewRecovery(httpErrors.RecoveryHandler), // panic恢复，防止admin接口panic把整个网关挂掉
		cors.New(...).Handler,            // CORS跨域（前端管理页面用）
	)
	// 分3组路由：公开路由、登录鉴权路由、需要jwt保护的接口
	s.addInternalPublicRoutes(r)
	s.addInternalAuthRoutes(r, guard)
	s.addInternalRoutes(r, guard)
}

//无需登录，公开接口
func (s *Server) addInternalPublicRoutes(r router.Router) {
	r.GET("/", Home())
	r.GET("/status", NewOverviewHandler(s.apiHandler.Cfgs))
	r.GET("/status/{name}", NewStatusHandler(s.apiHandler.Cfgs))
	if obs.PrometheusExporter != nil {
		r.Any("/metrics", obs.PrometheusExporter.ServeHTTP)
	}
}
//登录、刷新 token
func (s *Server) addInternalAuthRoutes(r router.Router, guard jwt.Guard) {
	handlers := jwt.Handler{Guard: guard}
	r.POST("/login", handlers.Login(s.Credentials))
	authGroup := r.Group("/auth")
	{
		authGroup.GET("/refresh_token", handlers.Refresh())
	}
}
// JWT 保护核心管理接口 + pprof
func (s *Server) addInternalRoutes(r router.Router, guard jwt.Guard) {
	log.Debug("Loading API Endpoints")

	// APIs endpoints
	groupAPI := r.Group("/apis")
	groupAPI.Use(jwt.NewMiddleware(guard).Handler)
	{
		groupAPI.GET("/", s.apiHandler.Get())
		groupAPI.GET("/{name}", s.apiHandler.GetBy())
		groupAPI.POST("/", s.apiHandler.Post())
		groupAPI.PUT("/{name}", s.apiHandler.PutBy())
		groupAPI.DELETE("/{name}", s.apiHandler.DeleteBy())
	}

	if s.profilingEnabled {
		groupProfiler := r.Group("/debug/pprof")
		if !s.profilingPublic {
			groupProfiler.Use(jwt.NewMiddleware(guard).Handler)
		}
		{
			groupProfiler.GET("/*", pprof.Index)
			groupProfiler.GET("/cmdline", pprof.Cmdline)
			groupProfiler.GET("/profile", pprof.Profile)
			groupProfiler.GET("/symbol", pprof.Symbol)
			groupProfiler.GET("/trace", pprof.Trace)
		}
	}
}

func (s *Server) listenAndServe(handler http.Handler) error {
	address := fmt.Sprintf(":%v", s.Port)

	log.Info("Janus Admin API started")
	if s.TLS.IsHTTPS() {
		addressTLS := fmt.Sprintf(":%v", s.TLS.Port)
		if s.TLS.Redirect {
			go func() {
				log.WithField("address", address).Info("Listening HTTP redirects to HTTPS")
				log.Fatal(http.ListenAndServe(address, RedirectHTTPS(s.TLS.Port)))
			}()
		}

		log.WithField("address", addressTLS).Info("Listening HTTPS")
		return http.ListenAndServeTLS(addressTLS, s.TLS.CertFile, s.TLS.KeyFile, handler)
	}

	log.WithField("address", address).Info("Certificate and certificate key were not found, defaulting to HTTP")
	return http.ListenAndServe(address, handler)
}

```