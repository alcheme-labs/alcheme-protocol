#!/bin/bash
set -e

# ============================================
# SocialHub Protocol - 优化部署脚本
# ============================================
# 
# 用途：将所有程序部署到 Surfpool 本地测试网
# 
# 优化策略：
# 1. 使用 opt-level=z 减小程序体积
# 2. 逐个部署而非批量（更稳定）
# 3. 自动重试失败的部署
# 4. 为大程序提高计算单元价格
#
# 使用方法：
#   chmod +x scripts/deploy-local-optimized.sh
#   ./scripts/deploy-local-optimized.sh
#
# 前置条件：
#   - surfpool start 已运行
#   - 钱包有足够的 SOL（会自动空投）
# ============================================

# 切换到项目根目录（确保相对路径正确）
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

echo "🚀 优化部署SocialHub Protocol到Surfpool"
echo "========================================"
echo "工作目录: $(pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
RPC_URL="${RPC_URL:-http://127.0.0.1:8899}"

program_is_deployed() {
  local program_id="$1"
  local response
  response="$(curl -sS --max-time 3 \
    -X POST "$RPC_URL" \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$program_id\",{\"encoding\":\"base64\"}]}" \
    2>/dev/null || true)"

  [[ -n "$response" && "$response" != *'"value":null'* && "$response" == *'"value":{'* ]]
}

# ============================================
# 步骤 1: 检查运行环境
# ============================================
# 检查surfpool状态
echo -e "${YELLOW}检查Surfpool状态...${NC}"
if ! curl -s http://localhost:8899 -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1, "method":"getHealth"}' | grep -q "ok"; then
  echo -e "${RED}❌ Surfpool未启动！${NC}"
  echo "请运行: surfpool start"
  exit 1
fi
echo -e "${GREEN}✓ Surfpool运行中${NC}"

# ============================================
# 步骤 2: 准备钱包和资金
# ============================================
# 检查钱包余额
echo -e "\n${YELLOW}检查钱包余额...${NC}"
BALANCE=$(solana balance 2>/dev/null | awk '{print $1}')
if [ -z "$BALANCE" ] || (( $(echo "$BALANCE < 50" | bc -l 2>/dev/null || echo "0") )); then
  echo "余额不足，正在空投..."
  # 尝试不同额度的空投，某些可能会失败
  solana airdrop 100 || solana airdrop 50 || solana airdrop 10
fi
WALLET=$(solana address)
echo -e "${GREEN}✓ 钱包: $WALLET${NC}"
echo -e "${GREEN}✓ 余额: $(solana balance)${NC}"

# ============================================
# 步骤 3: 清理旧构建产物
# ============================================
# 只清理最终产物，保留编译缓存（避免重新编译依赖）
echo -e "\n${YELLOW}清理旧构建产物...${NC}"
rm -f target/deploy/*.so
rm -rf target/idl
rm -rf target/types
echo -e "${GREEN}✓ 清理完成（保留 keypair 和编译缓存）${NC}"

# ============================================
# 步骤 4: 同步 Program ID
# ============================================
# 确保源代码中的 declare_id!() 与 keypair 文件一致
echo -e "\n${YELLOW}同步 Program ID...${NC}"
anchor keys sync
echo -e "${GREEN}✓ 地址同步完成${NC}"

# ============================================
# 步骤 5: 优化构建所有程序
# ============================================
# 优化构建
echo -e "\n${YELLOW}优化构建程序（这可能需要几分钟）...${NC}"
echo -e "${BLUE}使用 release 模式优化程序大小...${NC}"

# RUSTFLAGS 优化说明：
# -C opt-level=z     : 最大化程序大小优化（而非速度）
# -C codegen-units=1 : 单一代码生成单元，允许更好的内联和优化
# 注意：不使用 lto，因为 cdylib 类型不支持
export RUSTFLAGS="-C opt-level=z -C codegen-units=1"
anchor build

echo -e "${GREEN}✓ 构建完成${NC}"

# 显示程序大小
echo -e "\n${YELLOW}程序大小:${NC}"
for program in identity_registry content_manager access_controller event_emitter registry_factory messaging_manager circle_manager external_app_registry external_app_economics; do
  if [ -f "target/deploy/${program}.so" ]; then
    SIZE=$(ls -lh target/deploy/${program}.so | awk '{print $5}')
    echo -e "  ${program}: ${SIZE}"
  fi
done

# ============================================
# 步骤 6: 逐个部署程序
# ============================================
# 逐个部署程序（更稳定）
echo -e "\n${YELLOW}逐个部署程序（更稳定的方式）...${NC}"
echo -e "${BLUE}为什么逐个部署？${NC}"
echo -e "  • 避免并发部署导致的区块拥堵"
echo -e "  • 大程序（如 content_manager）需要更多时间"
echo -e "  • 可以针对每个程序调整参数"
echo -e "  • 失败后可以单独重试\n"

programs=(
  "identity_registry"    # ~440KB - 身份管理
  "content_manager"      # ~778KB - 内容管理（最大）
  "access_controller"    # ~527KB - 权限控制
  "event_emitter"        # ~578KB - 事件系统
  "registry_factory"     # ~517KB - 注册表工厂
  "messaging_manager"    # ~327KB - 即时通讯
  "circle_manager"       # ~342KB - 圈层管理
  "external_app_registry" # 外部应用注册审计根
  "external_app_economics" # 外部应用 V3B 有界经济模块
)

deployed_count=0

for program in "${programs[@]}"; do
  # 提取程序名（去掉注释）
  program_name=$(echo $program | awk '{print $1}')
  echo -e "\n${BLUE}[$(($deployed_count + 1))/${#programs[@]}] 部署 $program_name...${NC}"
  
  # 针对不同大小的程序动态调整参数
  ATTEMPTS=200
  PRICE=1000

  if [[ "$program_name" == "content_manager" ]]; then
      ATTEMPTS=1000
      PRICE=100000
      echo -e "${YELLOW}⚠️  检测到大型程序 content_manager，启用增强部署模式 (Retry: $ATTEMPTS, Price: $PRICE)...${NC}"
  fi
  
  # solana program deploy 参数说明：
  # --program-id           : 使用预生成的程序ID keypair
  # --max-sign-attempts    : 增加重试次数防止 blockhash 过期
  # --with-compute-unit-price: 提高优先级（微付费）
  # --use-rpc             : 使用 RPC 部署（更可靠）
  
  # 注意：不使用 pipe (| tee)，以便正确捕获退出代码
  LOG_FILE="/tmp/${program_name}_deploy.log"
  echo -e "${BLUE}正在部署... (日志: $LOG_FILE)${NC}"
  echo "=== [$(date '+%F %T')] attempt=1 program=$program_name ===" > "$LOG_FILE"
  
  if solana program deploy \
    --program-id target/deploy/${program_name}-keypair.json \
    target/deploy/${program_name}.so \
    --max-sign-attempts $ATTEMPTS \
    --with-compute-unit-price $PRICE \
    --use-rpc >> "$LOG_FILE" 2>&1; then
    
    PROGRAM_ID=$(solana address -k target/deploy/${program_name}-keypair.json)
    echo -e "${GREEN}✓ $program_name 部署成功: $PROGRAM_ID${NC}"
    deployed_count=$((deployed_count + 1))
    
    # 等待区块确认（避免下一个部署冲突）
    sleep 3
  else
    # ============================================
    # 自动重试机制
    # ============================================
    # 如果首次部署失败（可能因为网络拥堵或 blockhash 过期）
    # 等待5秒后自动重试，使用更高的优先级
    FIRST_EXIT=$?
    echo "=== [$(date '+%F %T')] attempt=1 failed exit=$FIRST_EXIT ===" >> "$LOG_FILE"
    echo -e "${RED}❌ $program_name 部署失败${NC}"
    echo -e "${YELLOW}查看详细日志: $LOG_FILE${NC}"
    echo -e "${YELLOW}尝试重新部署该程序（双倍优先级）...${NC}"
    
    RETRY_PRICE=$((PRICE * 2))
    RETRY_ATTEMPTS=$((ATTEMPTS * 2))

    sleep 5
    echo "=== [$(date '+%F %T')] attempt=2 program=$program_name price=$RETRY_PRICE attempts=$RETRY_ATTEMPTS ===" >> "$LOG_FILE"
    if solana program deploy \
      --program-id target/deploy/${program_name}-keypair.json \
      target/deploy/${program_name}.so \
      --max-sign-attempts $RETRY_ATTEMPTS \
      --with-compute-unit-price $RETRY_PRICE \
      --use-rpc >> "$LOG_FILE" 2>&1; then
      
      PROGRAM_ID=$(solana address -k target/deploy/${program_name}-keypair.json)
      echo -e "${GREEN}✓ $program_name 重试成功: $PROGRAM_ID${NC}"
      echo "=== [$(date '+%F %T')] attempt=2 success program_id=$PROGRAM_ID ===" >> "$LOG_FILE"
      deployed_count=$((deployed_count + 1))
      sleep 3
    else
      RETRY_EXIT=$?
      echo "=== [$(date '+%F %T')] attempt=2 failed exit=$RETRY_EXIT ===" >> "$LOG_FILE"
      echo -e "${RED}❌ $program_name 重试仍失败，继续下一个...${NC}"
      # 不中断，继续部署其他程序
    fi
  fi
done

# ============================================
# 步骤 7: 生成 SDK 配置文件
# ============================================
# 生成配置文件，供 TypeScript SDK 使用
echo -e "\n${YELLOW}生成配置文件...${NC}"
cat > sdk/localnet-config.json << EOF
{
  "network": "http://localhost:8899",
  "programIds": {
    "identity": "$(solana address -k target/deploy/identity_registry-keypair.json)",
    "content": "$(solana address -k target/deploy/content_manager-keypair.json)",
    "access": "$(solana address -k target/deploy/access_controller-keypair.json)",
    "event": "$(solana address -k target/deploy/event_emitter-keypair.json)",
    "factory": "$(solana address -k target/deploy/registry_factory-keypair.json)",
    "messaging": "$(solana address -k target/deploy/messaging_manager-keypair.json)",
    "circles": "$(solana address -k target/deploy/circle_manager-keypair.json)",
    "externalAppRegistry": "$(solana address -k target/deploy/external_app_registry-keypair.json)",
    "externalAppEconomics": "$(solana address -k target/deploy/external_app_economics-keypair.json)"
  }
}
EOF
echo -e "${GREEN}✓ 配置已保存到 sdk/localnet-config.json${NC}"

# ============================================
# 步骤 8: 验证所有程序部署状态
# ============================================
# 通过 solana program show 验证程序是否真的部署成功
echo -e "\n${YELLOW}验证部署...${NC}"
successful=0
for program in "${programs[@]}"; do
  program_name=$(echo $program | awk '{print $1}')
  PROGRAM_ID=$(solana address -k target/deploy/${program_name}-keypair.json)
  if program_is_deployed "$PROGRAM_ID"; then
    echo -e "${GREEN}✓ $program_name: $PROGRAM_ID${NC}"
    successful=$((successful + 1))
  else
    echo -e "${RED}✗ $program_name 验证失败${NC}"
  fi
done

# ============================================
# 步骤 9: 完成总结
# ============================================
# 完成
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}🎉 部署完成！${NC}"
echo -e "${GREEN}成功部署: $successful/${#programs[@]} 个程序${NC}"
echo -e "${GREEN}========================================${NC}"

if [ $successful -eq ${#programs[@]} ]; then
  echo -e "\n${GREEN}✅ 所有程序部署成功！${NC}"
  echo -e "\n${YELLOW}📋 下一步操作:${NC}"
  echo -e "1. 运行测试: ${YELLOW}anchor test --skip-build${NC}"
  echo -e "   验证所有程序功能正常"
  echo -e ""
  echo -e "2. 初始化程序: ${YELLOW}npx ts-node scripts/initialize-programs.ts${NC}"
  echo -e "   创建各程序的主账户（如 IdentityRegistry、ContentManager 等）"
  echo -e ""
  echo -e "3. 使用SDK: ${YELLOW}npx ts-node your-script.ts${NC}"
  echo -e "   通过 TypeScript SDK 与协议交互"
else
  # ============================================
  # 部分失败的情况
  # ============================================
  echo -e "\n${YELLOW}⚠️  部分程序部署失败${NC}"
  echo -e "${YELLOW}成功: $successful/${#programs[@]}${NC}\n"
  
  echo -e "${BLUE}可能的原因：${NC}"
  echo -e "  • Surfpool 网络拥堵"
  echo -e "  • 程序体积过大（超过 1MB）"
  echo -e "  • 钱包余额不足"
  echo -e "  • Blockhash 过期太快\n"
  
  echo -e "${YELLOW}建议操作：${NC}"
  echo -e "1. 重启 surfpool: ${YELLOW}surfpool stop && sleep 3 && surfpool start${NC}"
  echo -e "2. 检查日志: ${YELLOW}cat /tmp/*_deploy.log${NC}"
  echo -e "3. 重新运行: ${YELLOW}./scripts/deploy-local-optimized.sh${NC}"
  echo -e ""
  echo -e "4. 或切换到标准验证器: ${YELLOW}solana-test-validator --reset --quiet${NC}"
fi
