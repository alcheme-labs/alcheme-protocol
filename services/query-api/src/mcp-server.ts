import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";
import * as fs from 'fs/promises';
import * as path from 'path';
import { verifiedUserFilter } from './utils/filters.js';

// Initialize Prisma Client
const prisma = new PrismaClient();

// Create MCP Server
const server = new McpServer({
    name: "Alcheme Protocol MCP",
    version: "1.0.0"
});

// --- Resources ---

// Resource: Get protocol stats
server.resource(
    "protocol-stats",
    "alcheme://stats",
    async (uri) => {
        const userCount = await prisma.user.count();
        const postCount = await prisma.post.count();

        return {
            contents: [{
                uri: uri.href,
                text: JSON.stringify({
                    user_count: userCount,
                    post_count: postCount,
                    timestamp: new Date().toISOString()
                }, null, 2),
                mimeType: "application/json"
            }]
        };
    }
);

// Resource: Read documentation
server.resource(
    "protocol-docs",
    "alcheme://docs/{filename}",
    async (uri, variables) => {
        // Manually parse or use the variables if available, but to be safe with types:
        // The SDK generic types might imply variables are in the second arg but explicit typing helps.
        // Cast variables to any to bypass the strict type check failure for now
        const vars = variables as any;
        const filename = vars.filename;

        if (!filename) {
            throw new Error("Filename not provided in URI");
        }

        // Security: basic path traversal protection
        const sanitizedFilename = path.basename(filename);
        // Assuming docs are located at root/docs relative to the service
        // Service is in services/query-api, docs are in ../../docs
        const docsPath = path.resolve(__dirname, '../../../docs', sanitizedFilename);

        try {
            const content = await fs.readFile(docsPath, 'utf-8');
            return {
                contents: [{
                    uri: uri.href,
                    text: content,
                    mimeType: "text/markdown"
                }]
            };
        } catch (error) {
            throw new Error(`Document not found: ${filename}`);
        }
    }
);

// --- Tools ---

// Tool: Get Account Details
server.tool(
    "get_account",
    "Fetch detailed information about a protocol account (user)",
    {
        address: z.string().describe("The Solana wallet address of the user"),
        verifiedOnly: z.boolean().default(true).describe("Filter content to only show verified users (anti-spam)")
    },
    async ({ address, verifiedOnly }) => {
        // Helper to find by connection address
        const user = await prisma.user.findFirst({
            where: { onChainAddress: address },
            include: {
                posts: {
                    where: verifiedOnly ? verifiedUserFilter : {},
                    take: 5,
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!user) {
            return {
                content: [{
                    type: "text",
                    text: `User with address ${address} not found.`
                }]
            };
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify(user, null, 2)
            }]
        };
    }
);

// Tool: Search Documentation (Basic Implementation)
server.tool(
    "search_protocol_docs",
    "Search through protocol documentation files",
    {
        query: z.string().describe("The search term")
    },
    async ({ query }) => {
        const docsDir = path.resolve(__dirname, '../../../docs');
        const results: string[] = [];

        try {
            const files = await fs.readdir(docsDir);
            for (const file of files) {
                if (file.endsWith('.md')) {
                    const content = await fs.readFile(path.join(docsDir, file), 'utf-8');
                    if (content.toLowerCase().includes(query.toLowerCase())) {
                        results.push(`Found in ${file}`);
                    }
                }
            }
        } catch (err) {
            return {
                content: [{ type: "text", text: "Error reading documentation directory." }]
            }
        }

        return {
            content: [{
                type: "text",
                text: results.length > 0 ? results.join('\n') : "No matches found."
            }]
        };
    }
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Alcheme MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main loop:", error);
    process.exit(1);
});
