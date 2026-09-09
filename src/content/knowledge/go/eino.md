## 组装Agent流水线：

```yaml
adk.SequentialAgentConfig{
	Name : "",
	Description: "",
	SubAgents: []adk.Agent{
		subagent1,
		subagent2,
		subagent3,
	}
}
```

```go
type ChatOpenAI struct {
	Ctx          context.Context // 上下文（控制超时、取消）
	Model        string          // 模型名（gpt-3.5-turbo/gpt-4o）
	SystemPrompt string          // 系统提示词（设定AI角色）
	Tools        []mcp.Tool      // MCP 工具列表
	RagContext   string          // RAG 检索到的上下文
	Message      []openai.ChatCompletionMessageParamUnion // 对话历史
	LLM          openai.Client   // OpenAI 客户端实例
}
```

```go
// 定义函数类型：接收 *ChatOpenAI，无返回值
type LLMOption func(*ChatOpenAI)

// 设置系统提示词
func WithSystemPrompt(prompt string) LLMOption {
	return func(ai *ChatOpenAI) {
		ai.SystemPrompt = prompt
	}
}

// 设置 RAG 上下文
func WithRagContext(ragPrompt string) LLMOption {
	return func(ai *ChatOpenAI) {
		ai.RagContext = ragPrompt
	}
}
```

```go
NewChatOpenAI(ctx, "gpt-3.5-turbo",
	WithSystemPrompt("你是一个编程助手"),
	WithRagContext("Go 语言基础知识点")
)
```

### 大模型客户端的入口

```go
func NewChatOpenAI(ctx context.Context, model string, opts ...LLMOption) *ChatOpenAI {
	// 1. 必传参数校验
	if model == "" { panic("model is required") }

	// 2. 读取环境变量（你的 OpenAI Key 和代理地址）
	apiKey  := os.Getenv("ChatGPTOpenAPIKEY")
	baseURL := os.Getenv("ChatGPTBaseURL")
	if apiKey == "" { panic("apiKey is required") }

	// 3. 构建 OpenAI 客户端配置
	options := []option.RequestOption{option.WithAPIKey(apiKey)}
	if baseURL != "" { options = append(options, option.WithBaseURL(baseURL)) }

	// 4. 创建 OpenAI 客户端
	cli := openai.NewClient(options...)

	// 5. 初始化核心结构体
	llm := &ChatOpenAI{
		Ctx:     ctx,
		Model:   model,
		LLM:     cli,
		Message: make([]openai.ChatCompletionMessageParamUnion, 0), // 空对话历史
	}

	// 6. 应用所有选项（系统提示词、RAG）
	for _, opt := range opts { opt(llm) }

	// 7. 把系统提示词、RAG 加入对话历史
	if llm.SystemPrompt != "" {
		llm.Message = append(llm.Message, openai.SystemMessage(llm.SystemPrompt))
	}
	if llm.RagContext != "" {
		llm.Message = append(llm.Message, openai.UserMessage(llm.RagContext))
	}

	fmt.Println("successfully init LLM ")
	return llm
}
```

## 核心对话函数Chat

调用LLM,实现流式输出d

```go
把用户输入加入对话历史
转换 MCP 工具为 OpenAI 工具格式
流式调用 OpenAI 接口
逐字接收响应、拼接结果
接收工具调用（函数调用）
把 AI 回复加入对话历史（实现多轮对话）
```

```go
func (c *ChatOpenAI) Chat(prompt string) (result string, toolcall []openai.ToolCallUnion) {
	fmt.Println("init chat ...")
	// 1. 用户输入加入对话历史
	if prompt != "" {
		c.Message = append(c.Message, openai.UserMessage(prompt))
	}

	// 2. 转换 MCP 工具为 OpenAI 工具格式
	toolsParam := MCPTool2OpenAITool(c.Tools)
	// 这里代码有 BUG：如果有工具，直接置空了（后面会讲）
	if len(toolsParam) > 0 {
		toolsParam = nil
	}

	// 3. 流式调用 OpenAI
	stream := c.LLM.Chat.Completions.NewStreaming(c.Ctx, openai.ChatCompletionNewParams{
		Message: c.Message,  // 对话历史
		Seed:    openai.Int(0), // 随机种子
		Model:   c.Model,   // 模型
		Tools:   toolsParam,// 工具（函数调用）
	})

	// 4. 累加器：拼接流式响应
	acc := openai.ChatCompletionAccumulator{}
	var toolCalls []openai.ToolCallUnion
	result := ""
	finished := false

	fmt.Println("start chatting ....")
	// 5. 循环读取流式响应
	for stream.Next() {
		chunk := stream.Current() // 每次获取一小段数据
		acc.AddChunk(chunk)      // 加入累加器

		// 6. 检测：内容生成完成
		if content, ok := acc.JustFinishedContent(); ok {
			finished = true
			result = content
		}

		// 7. 检测：工具调用完成（函数调用）
		if tool, ok := acc.JustFinishedToolCall(); ok {
			toolCalls = append(toolCalls, openai.ToolCallUnion{
				ID: tool.ID,
				Function: openai.FunctionToolCallFunction{
					Name:      tool.Name,
					Arguments: tool.Arguments,
				},
			})
		}

		// 8. 逐字拼接结果（流式输出）
		if len(chunk.Choices) > 0 {
			delta := chunk.Choices[0].Delta.Content
			if !finished { result += delta }
		}
	}

	// 9. 把 AI 回复加入对话历史（多轮对话关键）
	if len(acc.Choices) > 0 {
		c.Message = append(c.Message, acc.Choices[0].Message.ToParam())
	}

	// 10. 错误处理
	if stream.Err() != nil { panic(stream.Err()) }

	return result, toolCalls
}
```

### 工具格式转换把MCP协议工具转换成Openai的工具格式

```go
func MCPTool2OpenAITool(mcpTools []mcp.Tool) []openai.ChatCompletionToolParam {
	openAITools := make([]openai.ChatCompletionToolUnionParam, 0)
	for _, tool := range mcpTools {
		// 构建函数参数（JSON Schema 格式）
		params := openai.FunctionParameters{
			"type":       tool.InputSchema.Type,
			"properties": tool.InputSchema.Properties,
			"required":   tool.InputSchema.Required,
		}
		// 默认类型为 object
		if t, ok := params["type"].(string); !ok || t == "" {
			params["type"] = "object"
		}
		// 组装成 OpenAI 工具格式
		openAITools = append(openAITools, openai.ChatCompletionToolUnionParam{
			OfFunction: &openai.ChatCompletionFunctionToolParam{
				Function: shared.FunctionDefinitionParam{
					Name:        tool.Name,
					Description: openai.String(tool.Description),
					Parameters:  params,
				},
			},
		})
	}
	return openAITools
}
```

// 直接传字符串！最简单！

```go
`msg := openai.UserMessage("你好，我是用户")

RAG 上下文 → 传【拼接好的文本】

context := "知识库内容：xxx\n用户问题：yyy"
msg := openai.UserMessage(context)

多轮对话 → 直接追加

// 你的代码里就是这么用的
c.Message = append(c.Message, openai.UserMessage("用户说的话"))

```

````

将Prompt和MCP Client的所有Tools以及所有RAG内容给到LLM

LLM根据prompt + Tools给出使用步骤和tools名字及其参数

有多个MCPclient， 找到对应的Tool是哪个mcp client

接着Mcp client调用Call Tool使用函数

```go
Chat：实现具体和LLM进行Chat，而这里我们 Stream 流式进行模型的通
信。而这个Chat函数的返回值有两个，一个是模型的结果
，另一个是模型让我们调用的工具。
```

1. MCP 的Start启动连接，这会`拉起一个MCP Server进程并建立连接`。
2. MCP 的初始化 Initialize，这会进行`协议握手`，双方进行确认。
3. MCP 的 CallTool 将 ToolName 和 Args 发给MCP Server。
````
