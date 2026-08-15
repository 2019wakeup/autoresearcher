#!/bin/bash
# 超时安全用例脚本：正常情况应被 run_experiment 的超时机制杀死
echo "slow experiment starting (should be killed by timeout)"
sleep 30
echo "this line should never appear"
exit 0
