import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const rows = await prisma.$queryRawUnsafe(`SELECT circle_id, draft_trigger_mode, trigger_summary_use_llm, summary_use_llm, trigger_generate_comment FROM circle_ghost_settings WHERE circle_id = 51`);
console.log(JSON.stringify(rows, null, 2));
await prisma.$disconnect();
