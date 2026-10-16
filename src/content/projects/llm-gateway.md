## cmd/server/main.go

> 读取 config → 初始化 logger → 连接 DB + AutoMigrate + seedData 种子数据 → 实例 Repo → 实例 Handler
> → 实例健康检查器，**启动巡检 goroutine**
> → **声明、注册全部路由 + 挂载中间件（gin 路由配置）**
> → 构造 http.Server
> → **开 goroutine 执行 srv.ListenAndServe（端口监听，放在协程）**
> → 主线程阻塞在信号 `<-quit`
> → 收到退出信号 → 执行优雅关闭 Shutdown

```go
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/code-explore-lab/llm-gateway/internal/config"
	"github.com/code-explore-lab/llm-gateway/internal/handler"
	"github.com/code-explore-lab/llm-gateway/internal/middleware"
	"github.com/code-explore-lab/llm-gateway/internal/model"
	"github.com/code-explore-lab/llm-gateway/internal/pkg/logger"
	"github.com/code-explore-lab/llm-gateway/internal/repo"
	"github.com/code-explore-lab/llm-gateway/internal/router"
)

func main() {
	// ./llm-gateway --config
	// 利用flag.String定义命令行参数--config
	configPath := flag.String("config", "configs/config.yaml", "path to config file")
	flag.Parse()
	// load yaml配置文件到结构体cfg
	cfg, err := config.Load(*configPath)
	if err != nil {
		panic(err)
	}

	log, err := logger.New(cfg.Log.Level)
	if err != nil {
		panic(err)
	}
	// 程序退出前刷写日志缓冲区，防止日志丢失
	defer log.Sync()

	log.Info("starting llm-gateway", zap.Int("port", cfg.Server.Port))
	//连接数据库，DSN 从配置读取；连接失败直接`log.Fatal`终止进程。
	db, err := model.NewDB(cfg.Database.DSN)
	if err != nil {
		log.Fatal("failed to open database", zap.Error(err))
	}
	//Gorm自动迁移
	if err := model.AutoMigrate(db); err != nil {
		log.Fatal("failed to migrate database", zap.Error(err))
	}
	// 执行种子初始化函数
	if err := seedData(db, cfg, log); err != nil {
		log.Fatal("failed to seed data", zap.Error(err))
	}
	// 实例化仓储层
	channelRepo := repo.NewChannelRepo(db)
	tokenRepo := repo.NewTokenRepo(db)
	logRepo := repo.NewLogRepo(db)
	// 实例化HTTP处理器， handler依赖repo
	chatHandler := handler.NewChatHandler(channelRepo, tokenRepo, logRepo, log)
	adminHandler := handler.NewAdminHandler(channelRepo)
	tokenHandler := handler.NewTokenHandler(tokenRepo)
	modelsHandler := handler.NewModelsHandler(channelRepo)
	statsHandler := handler.NewStatsHandler(db)

	// Start health checker in background
	healthChecker := router.NewHealthChecker(channelRepo)
	stopCh := make(chan struct{})
	go healthChecker.Start(stopCh)
	// gin模式设置
	gin.SetMode(cfg.Server.Mode)
	r := gin.New()
	r.Use(gin.Recovery(), middleware.CORS())

	r.GET("/healthz", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// /v1/models is public (OpenAI SDK calls it without auth)
	r.GET("/v1/models", modelsHandler.List)

	v1 := r.Group("/v1")
	v1.Use(middleware.Auth(tokenRepo), middleware.RateLimit())
	{
		//gin.Recovery->CORS->Auth 鉴权->RateLimit
		v1.POST("/chat/completions", chatHandler.ChatCompletions)
	}

	// Admin API (TODO: add admin auth in later issue)
	admin := r.Group("/admin")
	{
		admin.GET("/channels", adminHandler.ListChannels)
		admin.POST("/channels", adminHandler.CreateChannel)
		admin.PUT("/channels/:id", adminHandler.UpdateChannel)
		admin.DELETE("/channels/:id", adminHandler.DeleteChannel)

		admin.POST("/channels/:id/toggle", adminHandler.ToggleChannel)
		admin.GET("/tokens", tokenHandler.ListTokens)
		admin.POST("/tokens", tokenHandler.CreateToken)
		admin.PUT("/tokens/:id", tokenHandler.UpdateToken)
		admin.DELETE("/tokens/:id", tokenHandler.DeleteToken)
		admin.POST("/tokens/:id/toggle", tokenHandler.ToggleToken)
		admin.GET("/stats/total", statsHandler.StatsTotal)
		admin.GET("/stats/by-model", statsHandler.StatsByModel)
		admin.GET("/stats/by-channel", statsHandler.StatsByChannel)
		admin.GET("/stats/timeseries", statsHandler.TimeSeries)
		admin.GET("/stats/token-timeseries", statsHandler.TokenTimeSeries)
		admin.GET("/stats/token-by-model", statsHandler.TokenByModel)
		admin.GET("/stats/token-summary", statsHandler.TokenSummary)
		admin.GET("/stats/token-model-timeseries", statsHandler.TokenModelTimeSeries)
		admin.GET("/logs", statsHandler.ListLogs)
	}
	// Gin底层就是http.Handler
	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.Server.Port),
		Handler: r,
	}

	go func() {
		// ListenAndServe阻塞调用， 一直卡在这监听端口，必须放到goroutine里
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal("server failed", zap.Error(err))
		}
	}()
	// 信号捕捉 + 优雅关闭
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Info("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("server forced to shutdown", zap.Error(err))
	}
	log.Info("server exited")
}

func seedData(db *gorm.DB, cfg *config.Config, log *zap.Logger) error {
	// 定义变量存表记录总数
	var channelCount int64
	db.Model(&model.Channel{}).Count(&channelCount)
	// initialize
	if channelCount == 0 {
		// 每一项是预设LLM渠道
		for _, ch := range cfg.InitialChannels {
			c := model.Channel{
				Name: ch.Name, Type: ch.Type, BaseURL: ch.BaseURL,
				APIKey: ch.APIKey, Models: ch.Models, Weight: ch.Weight, Status: 1,
			}
			// Gorm插入单条记录， 生成Insert INTO channels ... SQL
			if err := db.Create(&c).Error; err != nil {
				return err
			}
			log.Info("seeded channel", zap.String("name", ch.Name))
		}
	}

	var tokenCount int64
	db.Model(&model.Token{}).Count(&tokenCount)
	if tokenCount == 0 {
		for _, t := range cfg.InitialTokens {
			tok := model.Token{Key: t.Key, Name: t.Name, Quota: t.Quota, Status: 1}
			if err := db.Create(&tok).Error; err != nil {
				return err
			}
			log.Info("seeded token", zap.String("name", t.Name))
		}
	}
	return nil
}

```

## internal/model/log.go

> 记录每一次 LLM 网关转发请求的完整调用日志

```go
package model

import "time"

// RequestLog records one LLM API call through the gateway.
type RequestLog struct {
	ID               uint      `gorm:"primaryKey" json:"id"`
	RequestID        string    `gorm:"index" json:"request_id"`
	TokenID          uint      `gorm:"index" json:"token_id"`
	TokenName        string    `json:"token_name"`
	ChannelID        uint      `gorm:"index" json:"channel_id"`
	ChannelName      string    `json:"channel_name"`
	Model            string    `gorm:"index" json:"model"`
	PromptTokens     int       `json:"prompt_tokens"`
	CompletionTokens int       `json:"completion_tokens"`
	TotalTokens      int       `json:"total_tokens"`
	LatencyMS        int64     `json:"latency_ms"`
	StatusCode       int       `json:"status_code"`
	CreatedAt        time.Time `json:"created_at"`
}
```

## internal/model/db.go

> 创建/打开Sqlite数据库，自动迁移

```go
package model

import (
	"fmt"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	// Pure-Go SQLite driver (no CGO). Registers as "sqlite".
	_ "modernc.org/sqlite"
)

// NewDB opens (or creates) the SQLite database and returns a handle.
// Uses modernc.org/sqlite (pure Go, no CGO) for easy cross-compilation.
func NewDB(dsn string) (*gorm.DB, error) {
	dialector := sqlite.Dialector{
		DriverName: "sqlite", // modernc.org/sqlite registers as "sqlite"
		DSN:        dsn,
	}

	db, err := gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Enable WAL mode for better concurrent read performance
	//Sqlite默认是DELETE模式， 写时锁整个库
	//WAL 预写日志模式， 读和写可以并发
	if sqlDB, err := db.DB(); err == nil {
		_, _ = sqlDB.Exec("PRAGMA journal_mode=WAL;")
		_, _ = sqlDB.Exec("PRAGMA foreign_keys=ON;")
	}

	return db, nil
}

// AutoMigrate runs schema migrations for all registered models.
func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(&Channel{}, &Token{}, &RequestLog{})
}

```

## internal/model/token.go

> 这个 `Token` 模型，代表**网关对外颁发的访问密钥**。
> 客户端 OpenAI SDK 请求 `/v1/chat/completions` 时，`Authorization: Bearer <Key>` 里的字符串，就是这里的 `Key`。
> 配套两个**模型方法（接收器方法）**：`IsExpired()` 判断是否过期，`HasQuota()` 判断还有没有额度。

```go
package model

import "time"

// Token represents a downstream virtual API key issued by the gateway.
type Token struct {
	ID         uint       `gorm:"primaryKey" json:"id"`
	Key        string     `gorm:"uniqueIndex;not null" json:"key"`
	Name       string     `json:"name"`
	Quota      int64      `gorm:"default:0" json:"quota"`       // total quota in tokens, 0 = unlimited
	UsedQuota  int64      `gorm:"default:0" json:"used_quota"`
	Models     string     `json:"models"` // allowed models, empty = all
	ExpiredAt  *time.Time `json:"expired_at,omitempty"`
	Status     int        `gorm:"default:1" json:"status"` // 1=enabled, 2=disabled
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// IsExpired returns true if the token has expired.
func (t *Token) IsExpired() bool {
	if t.ExpiredAt == nil {
		return false
	}
	return time.Now().After(*t.ExpiredAt)
}

// HasQuota returns true if the token has remaining quota (or unlimited).
func (t *Token) HasQuota() bool {
	if t.Quota == 0 {
		return true
	}
	return t.UsedQuota < t.Quota
}

```

## internal/model/channel.go

> Channel 代表**上游大模型服务商渠道**（比如 Ollama、OpenAI、通义千问）。网关收到 `/v1/chat/completions` 请求后，会从可用 Channels 里挑选一个，把请求转发给上游这个渠道。

```go
package model

import (
	"strings"
	"time"
)

// Channel represents an upstream LLM provider channel.
type Channel struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"uniqueIndex;not null" json:"name"`
	Type      string    `gorm:"not null" json:"type"` // openai, anthropic, gemini, ollama
	BaseURL   string    `gorm:"not null" json:"base_url"`
	APIKey    string    `gorm:"not null" json:"-"`
	Models    string    `gorm:"not null" json:"models"` // comma-separated model names
	Weight    int       `gorm:"default:1" json:"weight"`
	Priority  int       `gorm:"default:1" json:"priority"`
	Status    int       `gorm:"default:1" json:"status"` // 1=enabled, 2=auto-disabled, 3=manually disabled
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ModelNames returns the parsed list of model names this channel supports.
func (c *Channel) ModelNames() []string {
	//把逗号分隔的 `Models` 字符串，解析成模型名称切片 `[]string`。
	if c.Models == "" {
		return nil
	}
	var out []string
	for _, m := range splitAndTrim(c.Models, ",") {
		if m != "" {
			out = append(out, m)
		}
	}
	return out
}

func splitAndTrim(s, sep string) []string {
	var out []string
	cur := ""
	for _, ch := range s {
		if string(ch) == sep {
			out = append(out, strings.TrimSpace(cur))
			cur = ""
		} else {
			cur += string(ch)
		}
	}
	out = append(out, strings.TrimSpace(cur))
	return out
}

```

## internal/middleware/auth.go

> 这是 **Gin 鉴权中间件**，对应网关的接口校验逻辑。
> 所有受保护接口（`/v1/chat/completions`）路由挂载这个中间件，**请求进入 handler 之前先跑这套校验**。
> 作用：解析 HTTP `Authorization: Bearer xxx`，校验 token 合法性；校验全部通过，把 token 存入 gin 上下文，交给后续 handler 使用。

```go
package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/code-explore-lab/llm-gateway/internal/model"
	"github.com/code-explore-lab/llm-gateway/internal/repo"
)

const tokenContextKey = "gw_token"

// Auth returns a gin middleware that validates the Bearer token.
func Auth(tokenRepo *repo.TokenRepo) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing authorization header"})
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization format"})
			return
		}

		key := strings.TrimSpace(parts[1])
		token, err := tokenRepo.FindByKey(key)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			return
		}

		if token.Status != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token disabled"})
			return
		}

		if token.IsExpired() {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "token expired"})
			return
		}

		if !token.HasQuota() {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error": "quota exceeded"})
			return
		}

		c.Set(tokenContextKey, token)
		c.Next()
	}
}

// GetToken returns the authenticated token from context.
func GetToken(c *gin.Context) *model.Token {
	v, ok := c.Get(tokenContextKey)
	if !ok {
		return nil
	}
	t, _ := v.(*model.Token)
	return t
}

```

## internal/middleware/ratelimit.go

> 这是**内存版令牌桶限流中间件（Gin）**。
> 作用：对请求做 QPS 限流，按 `Authorization header`（也就是客户端 token）作为限流 key；拿不到 header 就 fallback 到客户端 IP。
> 令牌桶：固定速率往桶里放令牌，每一次请求消耗 1 个令牌；桶有最大容量（burst，突发峰值）。

```go
package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// rateLimiter implements a simple per-key token bucket in memory.
type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
	rate    float64 // tokens per second
	burst   float64 // 桶最大容量
}

type bucket struct {
	tokens  float64
	updated time.Time
}

func newRateLimiter(rate, burst float64) *rateLimiter {
	return &rateLimiter{
		buckets: make(map[string]*bucket),
		rate:    rate,
		burst:   burst,
	}
}

func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	b, ok := rl.buckets[key]
	if !ok {
		b = &bucket{tokens: rl.burst, updated: time.Now()}
		rl.buckets[key] = b
	}

	// Refill tokens based on elapsed time
	elapsed := time.Since(b.updated).Seconds()
	b.tokens += elapsed * rl.rate
	if b.tokens > rl.burst {
		b.tokens = rl.burst
	}
	b.updated = time.Now()

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// RateLimit returns a gin middleware that limits requests per API key.
func RateLimit() gin.HandlerFunc {
	rl := newRateLimiter(10, 20) // 10 req/s, burst 20
	return func(c *gin.Context) {
		key := c.GetHeader("Authorization")
		if key == "" {
			key = c.ClientIP()
		}
		if !rl.allow(key) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": gin.H{"message": "rate limit exceeded"},
			})
			return
		}
		c.Next()
	}
}

```

## internal/middleware/cors.go

> CORS = Cross-Origin Resource Sharing，**跨域资源共享**。
> 场景：管理后台前端（浏览器页面，比如前端页面跑在 `http://localhost:5173`）通过浏览器 AJAX/Fetch 请求后端网关接口（`http://127.0.0.1:8080`）。浏览器同源策略会拦截跨域请求，后端返回 CORS 响应头，告诉浏览器允许跨域访问。
> 这是一个 Gin 跨域中间件。

```go
package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// CORS allows cross-origin requests from the admin frontend.
func CORS() gin.HandlerFunc {
	return func(c *gin.Context) {
		// * 允许所有域名跨域访问
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization")
		c.Header("Access-Control-Max-Age", "86400")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

```

## internal/adapter/adapter.go

> 这是**适配器模式**，网关核心抽象！
> 网关对外统一暴露 **OpenAI 兼容协议**（客户端全部按 OpenAI 格式发请求），但是上游服务商（OpenAI、Anthropic、Ollama、Gemini）各自 API 协议有差异。
> `ProviderAdapter` 接口：**统一抽象一层**，把网关收到的标准 OpenAI 请求，转换成对应上游服务商原生 API 请求。新增一个厂商，只需要新增这个接口的实现，不用改动网关主调度逻辑。

```go
package adapter

import (
	"context"
	"net/http"

	"github.com/code-explore-lab/llm-gateway/internal/model"
)

// ProviderAdapter translates between the unified OpenAI-compatible request
// format and each upstream provider's native API.
type ProviderAdapter interface {
	// Name returns the adapter type name (e.g. "openai", "anthropic").
	Name() string

	// BuildRequest constructs an *http.Request to the upstream provider.
	// bodyBytes is the raw OpenAI-format request body from the client.
	BuildRequest(ctx context.Context, channel *model.Channel, bodyBytes []byte) (*http.Request, error)

	// IsStreaming returns true if the request is a streaming request.
	IsStreaming(bodyBytes []byte) bool
}

```

## internal/adapter/adapters.go

> > 这段代码实现了两个适配器：**OpenAIAdapter** 和 **AnthropicAdapter**，再加一个**适配器注册中心 Registry**。
> > 核心目标：对外网关统一接收 OpenAI 格式请求，内部根据渠道类型，翻译成不同厂商原生 API 请求。
> > 都实现了上一节的 `ProviderAdapter` 接口。

```go
package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/code-explore-lab/llm-gateway/internal/model"
)

// OpenAIAdapter handles OpenAI-compatible providers (OpenAI, DeepSeek, Moonshot, Ollama, etc.)
type OpenAIAdapter struct{}

func NewOpenAIAdapter() *OpenAIAdapter { return &OpenAIAdapter{} }

func (a *OpenAIAdapter) Name() string { return "openai" }

func (a *OpenAIAdapter) BuildRequest(ctx context.Context, ch *model.Channel, body []byte) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ch.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+ch.APIKey)
	return req, nil
}

func (a *OpenAIAdapter) IsStreaming(body []byte) bool {
	var r struct {
		Stream bool `json:"stream"`
	}
	if err := json.Unmarshal(body, &r); err != nil {
		return false
	}
	return r.Stream
}

// AnthropicAdapter translates OpenAI chat format to Anthropic Messages API.
type AnthropicAdapter struct{}

func NewAnthropicAdapter() *AnthropicAdapter { return &AnthropicAdapter{} }

func (a *AnthropicAdapter) Name() string { return "anthropic" }

func (a *AnthropicAdapter) BuildRequest(ctx context.Context, ch *model.Channel, body []byte) (*http.Request, error) {
	// Convert OpenAI request to Anthropic Messages format
	var oaiReq struct {
		Model       string `json:"model"`
		Messages    []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		Stream    bool   `json:"stream"`
		MaxTokens int    `json:"max_tokens"`
	}
	if err := json.Unmarshal(body, &oaiReq); err != nil {
		return nil, fmt.Errorf("parse openai request: %w", err)
	}

	// Anthropic requires system messages to be extracted to top-level "system"
	var system string
	var anthroMessages []map[string]string
	for _, m := range oaiReq.Messages {
		if m.Role == "system" {
			system = m.Content
		} else {
			anthroMessages = append(anthroMessages, map[string]string{
				"role":    m.Role,
				"content": m.Content,
			})
		}
	}

	maxTokens := oaiReq.MaxTokens
	if maxTokens == 0 {
		maxTokens = 4096
	}

	anthroReq := map[string]interface{}{
		"model":      oaiReq.Model,
		"messages":   anthroMessages,
		"max_tokens": maxTokens,
		"stream":     oaiReq.Stream,
	}
	if system != "" {
		anthroReq["system"] = system
	}

	anthroBody, _ := json.Marshal(anthroReq)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, ch.BaseURL+"/messages", bytes.NewReader(anthroBody))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", ch.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	return req, nil
}

func (a *AnthropicAdapter) IsStreaming(body []byte) bool {
	var r struct {
		Stream bool `json:"stream"`
	}
	json.Unmarshal(body, &r)
	return r.Stream
}

// Registry maps channel type names to adapters.
type Registry struct {
	adapters map[string]ProviderAdapter
}

func NewRegistry() *Registry {
	r := &Registry{adapters: make(map[string]ProviderAdapter)}
	r.Register(NewOpenAIAdapter())
	r.Register(NewAnthropicAdapter())
	return r
}

func (r *Registry) Register(a ProviderAdapter) {
	r.adapters[a.Name()] = a
}

func (r *Registry) Get(channelType string) ProviderAdapter {
	if a, ok := r.adapters[channelType]; ok {
		return a
	}
	// Default to openai-compatible for unknown types
	return r.adapters["openai"]
}

```

## internal/config/config.go

> 这是项目**配置加载模块**，用 `viper`（Go 生态最常用配置库）读取配置文件（yaml/toml/json），并且映射到 Go 结构体。
> 作用：网关启动的时候，从配置文件加载服务端口、数据库连接信息、日志级别、**初始化渠道列表、初始化 token 密钥**。
> `mapstructure` 是 viper 用来做配置 key 和结构体字段绑定的 tag。

```go
package config

import (
	"fmt"

	"github.com/spf13/viper"
)

type Config struct {
	Server          ServerConfig   `mapstructure:"server"`
	Database        DatabaseConfig `mapstructure:"database"`
	Log             LogConfig      `mapstructure:"log"`
	InitialChannels []SeedChannel  `mapstructure:"initial_channels"`
	InitialTokens   []SeedToken    `mapstructure:"initial_tokens"`
}

type ServerConfig struct {
	Port int    `mapstructure:"port"`
	Mode string `mapstructure:"mode"`
}

type DatabaseConfig struct {
	Driver string `mapstructure:"driver"`
	DSN    string `mapstructure:"dsn"`
}

type LogConfig struct {
	Level string `mapstructure:"level"`
}

type SeedChannel struct {
	Name    string `mapstructure:"name"`
	Type    string `mapstructure:"type"`
	BaseURL string `mapstructure:"base_url"`
	APIKey  string `mapstructure:"api_key"`
	Models  string `mapstructure:"models"`
	Weight  int    `mapstructure:"weight"`
}

type SeedToken struct {
	Name  string `mapstructure:"name"`
	Key   string `mapstructure:"key"`
	Quota int64  `mapstructure:"quota"`
}

func Load(path string) (*Config, error) {
	v := viper.New()
	// 设置配置文件
	v.SetConfigFile(path)
	v.AutomaticEnv()
	//读系统环境变量
	if err := v.ReadInConfig(); err != nil {
		return nil, fmt.Errorf("read config: %w", err)
	}
	//序列化到结构体里面
	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshal config: %w", err)
	}

	return &cfg, nil
}

```

## internal/pkg/logger/logger.go

```go
package logger

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

func New(level string) (*zap.Logger, error) {
	var lvl zapcore.Level
	if err := lvl.UnmarshalText([]byte(level)); err != nil {
		lvl = zapcore.InfoLevel
	}

	cfg := zap.NewProductionConfig()
	cfg.Level = zap.NewAtomicLevelAt(lvl)
	//自定义的key
	cfg.EncoderConfig.TimeKey = "ts"
	cfg.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder

	return cfg.Build()
}

```

## internal/router/balancer.go

> 这是**负载均衡器**，接口定义 + 加权随机（Weighted Random）
> 作用：当同一个模型有多条上游 channel（多个服务商 / 多个 key），收到请求时，按权重挑选其中一条渠道转发请求。

```go
package router

import (
	"math/rand"
	"sync"

	"github.com/code-explore-lab/llm-gateway/internal/model"
)

// LoadBalancer selects a channel from a pool.
type LoadBalancer interface {
	Select(channels []model.Channel) *model.Channel
}

// WeightedRoundRobin assigns probabilities proportional to channel weight.
// 加权轮询
type WeightedRoundRobin struct {
	mu   sync.Mutex
	next map[uint]int // per-model round-robin counter
}

func NewWeightedRoundRobin() *WeightedRoundRobin {
	return &WeightedRoundRobin{next: make(map[uint]int)}
}

func (b *WeightedRoundRobin) Select(channels []model.Channel) *model.Channel {
	if len(channels) == 0 {
		return nil
	}
	if len(channels) == 1 {
		return &channels[0]
	}
	// 权重兜底是1
	totalWeight := 0
	for _, ch := range channels {
		w := ch.Weight
		if w <= 0 {
			w = 1
		}
		totalWeight += w
	}
	//核心加权随机算法逻辑：
	//循环减去权重，一旦 r<0，就选中当前 channel
	r := rand.Intn(totalWeight)
	for _, ch := range channels {
		w := ch.Weight
		if w <= 0 {
			w = 1
		}
		r -= w
		if r < 0 {
			return &ch
		}
	}
	return &channels[0]
}

```

## internal/router/circuit.go

> 实现**服务熔断 + 定时健康探测**
> 场景：上游 LLM 渠道（channel）如果持续报错、超时、5xx，**熔断器快速切断这个渠道，负载均衡不再选它**，避免大量请求全部打到故障上游，引发雪崩。

```go
package router

import (
	"net/http"
	"sync"
	"time"

	"github.com/code-explore-lab/llm-gateway/internal/model"
)

// CircuitBreaker tracks failure state per channel and blocks selection when open.
type CircuitBreaker struct {
	mu        sync.Mutex
	failures  map[uint]int       // channelID -> consecutive failures
	openUntil map[uint]time.Time // channelID -> when circuit closes
	threshold int
	cooldown  time.Duration
}

func NewCircuitBreaker() *CircuitBreaker {
	return &CircuitBreaker{
		failures:  make(map[uint]int),
		openUntil: make(map[uint]time.Time),
		threshold: 5,
		cooldown:  30 * time.Second,
	}
}

// Allow returns true if the channel is allowed to receive traffic.
func (cb *CircuitBreaker) Allow(channelID uint) bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()

	if until, ok := cb.openUntil[channelID]; ok {
		if time.Now().Before(until) {
			return false // 还在熔断冷却期，电路打开，拒绝流量
		}
		// Cooldown expired — half-open: allow one probe
		delete(cb.openUntil, channelID)
		cb.failures[channelID] = 0
	}
	return true
}

// RecordSuccess resets failure count on success.
func (cb *CircuitBreaker) RecordSuccess(channelID uint) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures[channelID] = 0
	delete(cb.openUntil, channelID)
}

// RecordFailure increments failure count, opens circuit after threshold.
func (cb *CircuitBreaker) RecordFailure(channelID uint) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.failures[channelID]++
	//请求失败：连续失败计数 + 1；如果达到阈值，设置熔断截止时间，开启熔断。
	if cb.failures[channelID] >= cb.threshold {
		cb.openUntil[channelID] = time.Now().Add(cb.cooldown)
	}
}

// HealthChecker periodically pings channels and marks them disabled on failure.
type HealthChecker struct {
	channelRepo ChannelLister
	client      *http.Client
	interval    time.Duration
}

// ChannelLister abstracts channel listing for health checking.
type ChannelLister interface {
	ListAll() ([]model.Channel, error)
}

func NewHealthChecker(repo ChannelLister) *HealthChecker {
	return &HealthChecker{
		channelRepo: repo,
		client:      &http.Client{Timeout: 10 * time.Second},
		interval:    60 * time.Second,
	}
}

// Start runs health checks in a goroutine until stopCh is closed.
func (h *HealthChecker) Start(stopCh <-chan struct{}) {
	ticker := time.NewTicker(h.interval)
	defer ticker.Stop()
	for {
		select {
		//开一个后台 goroutine，每 60s 执行一次健康探测
		case <-ticker.C:
			h.checkOnce()
		case <-stopCh:
			return
		}
	}
}

func (h *HealthChecker) checkOnce() {
	channels, err := h.channelRepo.ListAll()
	if err != nil {
		return
	}
	for i := range channels {
		ch := channels[i]
		if ch.Status != 1 {
			continue
		}
		// Simple health check: GET {base_url}/models
		resp, err := h.client.Get(ch.BaseURL + "/models")
		//判断失败：网络错误，或者返回码 >=500（服务端错误）
		if err != nil || resp.StatusCode >= 500 {
			// TODO: mark auto-disabled after N consecutive failures
			continue
		}
		resp.Body.Close()
	}
}

```

## internal/repo/log.go

> repo 层：**数据访问层（Repository 仓库模式）**，专门封装数据库 CRUD 操作，隔离业务代码和 ORM（GORM）。
> `LogRepo` 负责请求日志 `model.RequestLog` 的数据库写入，记录每次大模型调用的审计日志（消耗 token、渠道、耗时、错误信息等）。

```go
package repo

import (
	"github.com/code-explore-lab/llm-gateway/internal/model"
	"gorm.io/gorm"
)

type LogRepo struct {
	db *gorm.DB
}

func NewLogRepo(db *gorm.DB) *LogRepo {
	return &LogRepo{db: db}
}

// Create inserts a new request log.
func (r *LogRepo) Create(log *model.RequestLog) error {
	return r.db.Create(log).Error
}

```

## internal/repo/token.go

> TokenRepo 是**网关客户端密钥（Token）的数据仓库层**，负责网关鉴权 token 的数据库 CRUD + **原子配额扣减**，是网关鉴权、token 额度扣费的核心。

```go
package repo

import (
	"github.com/code-explore-lab/llm-gateway/internal/model"
	"gorm.io/gorm"
)

type TokenRepo struct {
	db *gorm.DB
}

func NewTokenRepo(db *gorm.DB) *TokenRepo {
	return &TokenRepo{db: db}
}

// FindByKey looks up a token by its key string.
// 通过 key 字符串查询 token
// `.First(&t)`：取第一条匹配记录，找不到记录 GORM 返回 `gorm.ErrRecordNotFound`
func (r *TokenRepo) FindByKey(key string) (*model.Token, error) {
	var t model.Token
	if err := r.db.Where("key = ?", key).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// FindByID returns a token by ID.
func (r *TokenRepo) FindByID(id uint) (*model.Token, error) {
	var t model.Token
	if err := r.db.First(&t, id).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

// DeductQuota atomically deducts tokens from a token's quota.
// Returns false if the deduction would exceed quota.
func (r *TokenRepo) DeductQuota(id uint, tokens int64) (bool, error) {
	result := r.db.Model(&model.Token{}).
		Where("id = ? AND (quota = 0 OR used_quota + ? <= quota)", id, tokens).
		Update("used_quota", gorm.Expr("used_quota + ?", tokens))
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected > 0, nil
}

// Create inserts a new token.
func (r *TokenRepo) Create(t *model.Token) error {
	return r.db.Create(t).Error
}

// ListAll returns all tokens.
func (r *TokenRepo) ListAll() ([]model.Token, error) {
	var tokens []model.Token
	err := r.db.Order("id ASC").Find(&tokens).Error
	return tokens, err
}

// Update saves changes to an existing token.
func (r *TokenRepo) Update(t *model.Token) error {
	return r.db.Save(t).Error
}

// Delete removes a token by ID.
func (r *TokenRepo) Delete(id uint) error {
	return r.db.Delete(&model.Token{}, id).Error
}

```

## internal/repo/channel.go

> ChannelRepo 是**上游 LLM 渠道的数据仓库层**，管理所有上游模型渠道（Claude / OpenAI 兼容接口）的 CRUD。

```go
package repo

import (
	"github.com/code-explore-lab/llm-gateway/internal/model"
	"gorm.io/gorm"
)

type ChannelRepo struct {
	db *gorm.DB
}

func NewChannelRepo(db *gorm.DB) *ChannelRepo {
	return &ChannelRepo{db: db}
}

// FindChannelsByModel returns all enabled channels that support the given model.
func (r *ChannelRepo) FindChannelsByModel(modelName string) ([]model.Channel, error) {
	var channels []model.Channel
	err := r.db.Where("status = ?", 1).
		Where("models LIKE ?", "%"+modelName+"%").
		Order("priority DESC, weight DESC").
		Find(&channels).Error
	return channels, err
}

// FindByID returns a channel by its ID.
func (r *ChannelRepo) FindByID(id uint) (*model.Channel, error) {
	var ch model.Channel
	if err := r.db.First(&ch, id).Error; err != nil {
		return nil, err
	}
	return &ch, nil
}

// ListAll returns all channels.
func (r *ChannelRepo) ListAll() ([]model.Channel, error) {
	var channels []model.Channel
	err := r.db.Order("id ASC").Find(&channels).Error
	return channels, err
}

// Create inserts a new channel.
func (r *ChannelRepo) Create(ch *model.Channel) error {
	return r.db.Create(ch).Error
}

// Update saves channel changes.
func (r *ChannelRepo) Update(ch *model.Channel) error {
	return r.db.Save(ch).Error
}

// Delete removes a channel.
func (r *ChannelRepo) Delete(id uint) error {
	return r.db.Delete(&model.Channel{}, id).Error
}

```

## internal/handler/admin.go

> AdminHandler 是**后台管理接口处理器（Gin）**，给管理后台提供渠道（channel）的增删改查 API，用来管理上游 LLM 渠道。
> 这是管理后台接口，

```go
package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/code-explore-lab/llm-gateway/internal/model"
	"github.com/code-explore-lab/llm-gateway/internal/repo"
)

type AdminHandler struct {
	channelRepo *repo.ChannelRepo
}

func NewAdminHandler(ch *repo.ChannelRepo) *AdminHandler {
	return &AdminHandler{channelRepo: ch}
}

func (h *AdminHandler) ListChannels(c *gin.Context) {
	channels, err := h.channelRepo.ListAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, channels)
}

func (h *AdminHandler) CreateChannel(c *gin.Context) {
	var ch model.Channel
	if err := c.ShouldBindJSON(&ch); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.channelRepo.Create(&ch); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, ch)
}

func (h *AdminHandler) UpdateChannel(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	ch, err := h.channelRepo.FindByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}
	// Read body manually so we can update api_key even though it has json:"-"
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if v, ok := body["name"]; ok { ch.Name = v.(string) }
	if v, ok := body["type"]; ok { ch.Type = v.(string) }
	if v, ok := body["base_url"]; ok { ch.BaseURL = v.(string) }
	if v, ok := body["api_key"]; ok && v.(string) != "" { ch.APIKey = v.(string) }
	if v, ok := body["models"]; ok { ch.Models = v.(string) }
	if v, ok := body["weight"]; ok { ch.Weight = int(v.(float64)) }
	if v, ok := body["status"]; ok { ch.Status = int(v.(float64)) }
	h.channelRepo.Update(ch)
	c.JSON(http.StatusOK, ch)
}

func (h *AdminHandler) DeleteChannel(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := h.channelRepo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}
//一键启停渠道 PATCH
func (h *AdminHandler) ToggleChannel(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	ch, err := h.channelRepo.FindByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "channel not found"})
		return
	}
	// Toggle: 1 -> 3 (disable), 3/2 -> 1 (enable)
	if ch.Status == 1 {
		ch.Status = 3
	} else {
		ch.Status = 1
	}
	h.channelRepo.Update(ch)
	c.JSON(http.StatusOK, ch)
}

```

## internal/handler/model.go

> ModelsHandler 是 OpenAI 兼容接口：`GET /v1/models` 的处理器，用来列出网关支持的全部模型列表

```go
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/code-explore-lab/llm-gateway/internal/repo"
)

type ModelsHandler struct {
	channelRepo *repo.ChannelRepo
}

func NewModelsHandler(ch *repo.ChannelRepo) *ModelsHandler {
	return &ModelsHandler{channelRepo: ch}
}

// List returns all available models across enabled channels.
// OpenAI-compatible: GET /v1/models
func (h *ModelsHandler) List(c *gin.Context) {
	channels, err := h.channelRepo.ListAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	seen := make(map[string]bool)
	var models []gin.H
	for _, ch := range channels {
		if ch.Status != 1 {
			continue
		}
		for _, m := range ch.ModelNames() {
			if !seen[m] {
				seen[m] = true
				models = append(models, gin.H{
					"id":      m,
					"object":  "model",
					"created": 0,
					"owned_by": ch.Type,
				})
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"object": "list",
		"data":   models,
	})
}

```

## internal/handler/token.go

> TokenHandler 是后台管理接口处理器，专门管理**网关客户端鉴权 Token**，提供 CRUD 接口。

```go
package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/code-explore-lab/llm-gateway/internal/model"
	"github.com/code-explore-lab/llm-gateway/internal/repo"
)

type TokenHandler struct {
	tokenRepo *repo.TokenRepo
}

func NewTokenHandler(tr *repo.TokenRepo) *TokenHandler {
	return &TokenHandler{tokenRepo: tr}
}

func (h *TokenHandler) ListTokens(c *gin.Context) {
	tokens, err := h.tokenRepo.ListAll()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tokens)
}

func (h *TokenHandler) CreateToken(c *gin.Context) {
	var t model.Token
	if err := c.ShouldBindJSON(&t); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.tokenRepo.Create(&t); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, t)
}

func (h *TokenHandler) UpdateToken(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	t, err := h.tokenRepo.FindByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
		return
	}
	if err := c.ShouldBindJSON(t); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.tokenRepo.Update(t)
	c.JSON(http.StatusOK, t)
}

func (h *TokenHandler) DeleteToken(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	if err := h.tokenRepo.Delete(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h *TokenHandler) ToggleToken(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	t, err := h.tokenRepo.FindByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "token not found"})
		return
	}
	if t.Status == 1 {
		t.Status = 2
	} else {
		t.Status = 1
	}
	h.tokenRepo.Update(t)
	c.JSON(http.StatusOK, t)
}

```

## internal/handler/stats.go

```go
package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/code-explore-lab/llm-gateway/internal/model"
)

type StatsHandler struct {
	db *gorm.DB
}

func NewStatsHandler(db *gorm.DB) *StatsHandler {
	return &StatsHandler{db: db}
}

// dateBucket is the SQLite expression used to bucket request_logs by day.
//
// created_at is written by GORM using Go's time.Time.String() layout, e.g.
// "2026-10-12 12:34:56 +0000 UTC". SQLite's date() and strftime() cannot parse
// that trailing timezone *name*, so both return NULL -- every row then collapses
// into a single bucket with an empty date and the trend charts break.
// The stored value always begins with YYYY-MM-DD, so taking the first 10
// characters buckets correctly, and in the writer's own timezone (which is what
// the dashboard should show).
const dateBucket = "substr(created_at, 1, 10)"

// recentWindow builds the shared "last N days" predicate. It compares the
// stored local date prefix against the local date so the window and the
// buckets agree.
func recentWindow(days int) (string, string) {
	return dateBucket + " >= date('now','localtime', ?)", "-" + itoa(days-1) + " day"
}

// StatsTotal returns overall usage totals.
func (h *StatsHandler) StatsTotal(c *gin.Context) {
	var result struct {
		TotalRequests int64   `json:"total_requests"`
		TotalTokens   int64   `json:"total_tokens"`
		TotalCost     float64 `json:"total_cost"`
	}
	h.db.Model(&model.RequestLog{}).
		Select("COUNT(*) as total_requests, COALESCE(SUM(total_tokens),0) as total_tokens").
		Scan(&result)

	c.JSON(http.StatusOK, result)
}

// StatsByModel returns usage aggregated by model.
func (h *StatsHandler) StatsByModel(c *gin.Context) {
	type row struct {
		Model       string `json:"model"`
		Count       int64  `json:"count"`
		TotalTokens int64  `json:"total_tokens"`
	}
	var rows []row
	h.db.Model(&model.RequestLog{}).
		Select("model, COUNT(*) as count, COALESCE(SUM(total_tokens),0) as total_tokens").
		Group("model").
		Order("count DESC").
		Scan(&rows)

	c.JSON(http.StatusOK, rows)
}

// StatsByChannel returns usage aggregated by channel.
func (h *StatsHandler) StatsByChannel(c *gin.Context) {
	type row struct {
		ChannelName string  `json:"channel_name"`
		Count       int64   `json:"count"`
		AvgLatency  float64 `json:"avg_latency_ms"`
	}
	var rows []row
	h.db.Model(&model.RequestLog{}).
		Select("channel_name, COUNT(*) as count, COALESCE(AVG(latency_ms),0) as avg_latency_ms").
		Group("channel_name").
		Scan(&rows)

	c.JSON(http.StatusOK, rows)
}

// TimeSeries returns per-day aggregated stats for line charts.
func (h *StatsHandler) TimeSeries(c *gin.Context) {
	days := 7
	if d := c.Query("days"); d != "" {
		if n, err := strconv.Atoi(d); err == nil && n > 0 && n <= 90 {
			days = n
		}
	}

	type row struct {
		Date        string `json:"date"`
		Count       int64  `json:"count"`
		TotalTokens int64  `json:"total_tokens"`
		Errors      int64  `json:"errors"`
	}
	var rows []row
	where, arg := recentWindow(days)
	h.db.Model(&model.RequestLog{}).
		Select(dateBucket+" as date, COUNT(*) as count, COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END),0) as errors").
		Where(where, arg).
		Group(dateBucket).
		Order("date ASC").
		Scan(&rows)

	c.JSON(http.StatusOK, rows)
}

// ListLogs returns paginated request logs.
func (h *StatsHandler) ListLogs(c *gin.Context) {
	pageSize := 20
	if ps := c.Query("page_size"); ps != "" {
		if n, err := strconv.Atoi(ps); err == nil && n > 0 && n <= 200 {
			pageSize = n
		}
	}

	var logs []model.RequestLog
	h.db.Model(&model.RequestLog{}).
		Order("created_at DESC").
		Limit(pageSize).
		Find(&logs)

	c.JSON(http.StatusOK, gin.H{
		"data": logs,
		"size": pageSize,
	})
}

/* ------------------------- Token 维度用量统计 ------------------------- */

// parseTokenID reads the required token_id query parameter.
func parseTokenID(c *gin.Context) (uint, bool) {
	raw := c.Query("token_id")
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token_id is required"})
		return 0, false
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "token_id must be a positive integer"})
		return 0, false
	}
	return uint(n), true
}

// daysParam reads the optional days window, clamped to 1..90 (falls back to
// def when absent or invalid).
func daysParam(c *gin.Context, def int) int {
	raw := c.Query("days")
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 || n > 90 {
		return def
	}
	return n
}

// TokenTimeSeries returns per-day request counts and token usage for one token.
func (h *StatsHandler) TokenTimeSeries(c *gin.Context) {
	tokenID, ok := parseTokenID(c)
	if !ok {
		return
	}
	days := daysParam(c, 7)

	type row struct {
		Date        string `json:"date"`
		Count       int64  `json:"count"`
		TotalTokens int64  `json:"total_tokens"`
		Errors      int64  `json:"errors"`
	}
	// Non-nil so an empty result marshals to [] rather than null.
	rows := make([]row, 0)
	where, arg := recentWindow(days)
	h.db.Model(&model.RequestLog{}).
		Select(dateBucket+" as date, COUNT(*) as count, COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END),0) as errors").
		Where("token_id = ?", tokenID).
		Where(where, arg).
		Group(dateBucket).
		Order("date ASC").
		Scan(&rows)

	c.JSON(http.StatusOK, rows)
}

// TokenByModel returns usage for one token aggregated by model.
func (h *StatsHandler) TokenByModel(c *gin.Context) {
	tokenID, ok := parseTokenID(c)
	if !ok {
		return
	}
	days := daysParam(c, 7)

	type row struct {
		Model       string `json:"model"`
		Count       int64  `json:"count"`
		TotalTokens int64  `json:"total_tokens"`
	}
	rows := make([]row, 0)
	where, arg := recentWindow(days)
	h.db.Model(&model.RequestLog{}).
		Select("model, COUNT(*) as count, COALESCE(SUM(total_tokens),0) as total_tokens").
		Where("token_id = ?", tokenID).
		Where(where, arg).
		Group("model").
		Order("total_tokens DESC").
		Scan(&rows)

	c.JSON(http.StatusOK, rows)
}

// TokenSummary returns lifetime totals for one token.
func (h *StatsHandler) TokenSummary(c *gin.Context) {
	tokenID, ok := parseTokenID(c)
	if !ok {
		return
	}

	var result struct {
		TotalRequests int64   `json:"total_requests"`
		TotalTokens   int64   `json:"total_tokens"`
		AvgLatency    float64 `json:"avg_latency"`
	}
	if err := h.db.Model(&model.RequestLog{}).
		Select("COUNT(*) as total_requests, COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(AVG(latency_ms),0) as avg_latency").
		Where("token_id = ?", tokenID).
		Scan(&result).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// TokenModelTimeSeries returns per-day, per-model usage for one token.
// TokenByModel only yields aggregates, which is not enough to draw the
// per-model trend charts in the UI, so this supplies the time dimension.
func (h *StatsHandler) TokenModelTimeSeries(c *gin.Context) {
	tokenID, ok := parseTokenID(c)
	if !ok {
		return
	}
	days := daysParam(c, 7)

	type row struct {
		Date        string `json:"date"`
		Model       string `json:"model"`
		Count       int64  `json:"count"`
		TotalTokens int64  `json:"total_tokens"`
	}
	rows := make([]row, 0)
	where, arg := recentWindow(days)
	h.db.Model(&model.RequestLog{}).
		Select(dateBucket+" as date, model, COUNT(*) as count, COALESCE(SUM(total_tokens),0) as total_tokens").
		Where("token_id = ?", tokenID).
		Where(where, arg).
		Group(dateBucket + ", model").
		Order("date ASC").
		Scan(&rows)

	c.JSON(http.StatusOK, rows)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [12]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}

```

## internal/handler/chat.go

> `ChatHandler` 是整套 LLM 网关**最核心的接口处理器**，对应 OpenAI 兼容接口：`POST /v1/chat/completions`。
> 核心能力：客户端请求鉴权、上游渠道负载均衡、熔断器故障隔离、故障自动故障转移 (failover)、SSE 流式转发、用量扣减、审计日志入库。

```go
package handler

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/code-explore-lab/llm-gateway/internal/adapter"
	"github.com/code-explore-lab/llm-gateway/internal/middleware"
	"github.com/code-explore-lab/llm-gateway/internal/model"
	"github.com/code-explore-lab/llm-gateway/internal/repo"
	"github.com/code-explore-lab/llm-gateway/internal/router"
)

type ChatHandler struct {
	channelRepo    *repo.ChannelRepo      // 渠道仓库，查询该model对应的上游渠道列表
	tokenRepo      *repo.TokenRepo        // 客户端密钥仓库，扣减token配额
	logRepo        *repo.LogRepo          // 审计日志仓库，保存请求记录
	balancer       router.LoadBalancer    // 负载均衡器（加权轮询）
	adapters       *adapter.Registry      // 适配器注册表，不同类型上游API请求构建
	circuitBreaker *router.CircuitBreaker // 熔断器：故障渠道熔断隔离
	logger         *zap.Logger            // zap结构化日志
}

func NewChatHandler(ch *repo.ChannelRepo, tr *repo.TokenRepo, lr *repo.LogRepo, log *zap.Logger) *ChatHandler {
	return &ChatHandler{
		channelRepo:    ch,
		tokenRepo:      tr,
		logRepo:        lr,
		balancer:       router.NewWeightedRoundRobin(),
		adapters:       adapter.NewRegistry(),
		circuitBreaker: router.NewCircuitBreaker(),
		logger:         log,
	}
}

// Usage is the token usage block in OpenAI responses.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

func (h *ChatHandler) ChatCompletions(c *gin.Context) {
	start := time.Now()
	requestID := uuid.NewString()
	c.Header("X-Request-ID", requestID)

	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": gin.H{"message": "cannot read body"}})
		return
	}

	var req struct {
		Model  string `json:"model"`
		Stream bool   `json:"stream"`
	}
	json.Unmarshal(bodyBytes, &req)

	token := middleware.GetToken(c)

	channels, err := h.channelRepo.FindChannelsByModel(req.Model)
	if err != nil || len(channels) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"message": "no channel for model: " + req.Model}})
		return
	}

	// Try each channel until one succeeds (failover)
	var lastStatus int
	var usedChannel *model.Channel
	var usedUsage *Usage

	for range channels {
		ch := h.balancer.Select(channels)
		if ch == nil {
			continue
		}

		// Skip channels whose circuit is open
		if !h.circuitBreaker.Allow(ch.ID) {
			h.logger.Debug("circuit open, skipping channel", zap.String("channel", ch.Name))
			continue
		}

		a := h.adapters.Get(ch.Type)
		upstreamReq, err := a.BuildRequest(c.Request.Context(), ch, bodyBytes)
		if err != nil {
			h.logger.Warn("build request failed", zap.String("channel", ch.Name), zap.Error(err))
			h.circuitBreaker.RecordFailure(ch.ID)
			lastStatus = http.StatusBadGateway
			continue
		}

		client := &http.Client{Timeout: 120 * time.Second}
		resp, err := client.Do(upstreamReq)
		if err != nil {
			h.logger.Warn("upstream failed, trying next",
				zap.String("channel", ch.Name), zap.Error(err))
			h.circuitBreaker.RecordFailure(ch.ID)
			lastStatus = http.StatusBadGateway
			continue
		}

		// Non-retryable status: return immediately
		if resp.StatusCode >= 400 && resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			for k, vs := range resp.Header {
				for _, v := range vs {
					c.Writer.Header().Add(k, v)
				}
			}
			c.Writer.WriteHeader(resp.StatusCode)
			c.Writer.Write(body)
			h.logRequest(requestID, token, ch, req.Model, resp.StatusCode, start, nil)
			return
		}

		usedChannel = ch
		lastStatus = resp.StatusCode

		if req.Stream {
			h.streamResponse(c, resp, ch, token, req.Model, requestID, start)
			h.circuitBreaker.RecordSuccess(ch.ID)
			return
		}

		// Non-streaming: read full body, parse usage
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var parsed struct {
			Usage Usage `json:"usage"`
		}
		json.Unmarshal(body, &parsed)
		usedUsage = &parsed.Usage

		for k, vs := range resp.Header {
			for _, v := range vs {
				c.Writer.Header().Add(k, v)
			}
		}
		c.Writer.WriteHeader(resp.StatusCode)
		c.Writer.Write(body)

		// Success — record success and break out of failover loop
		if resp.StatusCode < 500 && resp.StatusCode != http.StatusTooManyRequests {
			h.circuitBreaker.RecordSuccess(ch.ID)
			break
		}
		// 5xx or 429 — record failure and try next channel
		h.circuitBreaker.RecordFailure(ch.ID)
	}

	if usedChannel == nil {
		c.JSON(lastStatus, gin.H{"error": gin.H{"message": "all channels failed"}})
		return
	}

	h.logRequest(requestID, token, usedChannel, req.Model, lastStatus, start, usedUsage)
	if usedUsage != nil && usedUsage.TotalTokens > 0 {
		_, _ = h.tokenRepo.DeductQuota(token.ID, int64(usedUsage.TotalTokens))
	}
}

// streamResponse pipes SSE chunks from upstream to client with flushing.
func (h *ChatHandler) streamResponse(c *gin.Context, resp *http.Response,
	ch *model.Channel, token *model.Token, modelName, requestID string, start time.Time) {

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Writer.WriteHeader(resp.StatusCode)

	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		io.Copy(c.Writer, resp.Body)
		resp.Body.Close()
		return
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	var finalUsage *Usage
	for scanner.Scan() {
		line := scanner.Bytes()
		// Try to extract usage from the final chunk (OpenAI sends it in the last data: line)
		if bytes.HasPrefix(line, []byte("data: ")) {
			data := bytes.TrimPrefix(line, []byte("data: "))
			if !bytes.Equal(data, []byte("[DONE]")) {
				var chunk struct {
					Usage *Usage `json:"usage"`
				}
				if json.Unmarshal(data, &chunk) == nil && chunk.Usage != nil {
					finalUsage = chunk.Usage
				}
			}
		}
		c.Writer.Write(line)
		c.Writer.Write([]byte("\n\n"))
		flusher.Flush()
	}
	resp.Body.Close()

	h.logRequest(requestID, token, ch, modelName, resp.StatusCode, start, finalUsage)
	if finalUsage != nil && finalUsage.TotalTokens > 0 {
		_, _ = h.tokenRepo.DeductQuota(token.ID, int64(finalUsage.TotalTokens))
	}
}

func (h *ChatHandler) logRequest(requestID string, token *model.Token, ch *model.Channel,
	modelName string, status int, start time.Time, usage *Usage) {

	entry := &model.RequestLog{
		RequestID:   requestID,
		TokenID:     token.ID,
		TokenName:   token.Name,
		ChannelID:   ch.ID,
		ChannelName: ch.Name,
		Model:       modelName,
		StatusCode:  status,
		LatencyMS:   time.Since(start).Milliseconds(),
	}
	if usage != nil {
		entry.PromptTokens = usage.PromptTokens
		entry.CompletionTokens = usage.CompletionTokens
		entry.TotalTokens = usage.TotalTokens
	}
	_ = h.logRepo.Create(entry)
}

```
