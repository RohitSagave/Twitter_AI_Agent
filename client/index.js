import { config } from 'dotenv';
import readline from 'readline/promises'
import { GoogleGenAI } from "@google/genai"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"


config()
let tools = []
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const mcpClient = new Client({
    name: "example-client",
    version: "1.0.0",
})



const chatHistory = [];
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});


mcpClient.connect(new SSEClientTransport(new URL("http://localhost:3001/sse")))
    .then(async () => {

        console.log("Connected to mcp server")

        tools = (await mcpClient.listTools()).tools.map(tool => {
            return {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: tool.inputSchema.type,
                    properties: tool.inputSchema.properties,
                    required: tool.inputSchema.required
                }
            }
        })

        chatLoop()


    })

    async function chatLoop(toolCall) {
        if (toolCall) {
            console.log("🔧 Tool requested:", toolCall.name);
    
            // If it's createPost, generate the tweet text first
            if (toolCall.name === "createPost") {
                const topic = toolCall.args.status || "a topic";
    
                console.log("📝 Generating tweet for topic:", topic);
    
                // Ask Gemini to write a tweet based on the topic
                const tweetResponse = await ai.models.generateContent({
                    model: "gemini-2.0-flash",
                    contents: [
                        {
                            role: "user",
                            parts: [
                                {
                                    text: `Write a Twitter post about: "${topic}". Include key facts, names, prices, features. Keep it within 280 characters and engaging.`,
                                    type: "text"
                                }
                            ]
                        }
                    ]
                });
    
                const tweetText = tweetResponse?.candidates?.[0]?.content?.parts?.[0]?.text;
    
                if (!tweetText) {
                    console.error("❌ Failed to generate tweet content.");
                    return chatLoop(); // back to prompt
                }
    
                console.log("✅ Generated Tweet:", tweetText);
    
                toolCall.args.status = tweetText;
            }
    
            // Now actually call the tool
            const toolResult = await mcpClient.callTool({
                name: toolCall.name,
                arguments: toolCall.args
            });
    
            const resultText = toolResult?.content?.[0]?.text || "No result text";
    
            console.log("📤 Tool executed, result:", resultText);
    
            chatHistory.push({
                role: "user",
                parts: [
                    {
                        text: "Tool result: " + resultText,
                        type: "text"
                    }
                ]
            });
    
        } else {
            const question = await rl.question('You: ');
            chatHistory.push({
                role: "user",
                parts: [
                    {
                        text: question,
                        type: "text"
                    }
                ]
            });
        }
    
        // Ask Gemini what to do next
        const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: chatHistory,
            config: {
                tools: [
                    {
                        functionDeclarations: tools,
                    }
                ],
                systemInstruction: {
                    role: "system",
                    parts: [
                        {
                            text: `When using the "createPost" tool, always generate a full tweet with informative and engaging content. Do not use just a topic or sentence.`,
                            type: "text"
                        }
                    ]
                }
            }
        });
    
        const part = response.candidates[0].content.parts[0];
    
        const functionCall = part?.functionCall;
        const responseText = part?.text;
    
        if (functionCall) {
            return chatLoop(functionCall);
        }
    
        if (responseText) {
            chatHistory.push({
                role: "model",
                parts: [
                    {
                        text: responseText,
                        type: "text"
                    }
                ]
            });
    
            console.log(`AI: ${responseText}`);
        }
    
        chatLoop();
    }
    

