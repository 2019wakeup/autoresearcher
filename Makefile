# AutoResearcher 开发/部署 Makefile
# 用法：make setup && make test && make smoke && make eval

.PHONY: setup test build smoke eval up down

setup:            ## 一键安装依赖（venv + npm）
	python3 -m venv .venv
	.venv/bin/pip install -r backend/requirements.txt
	cd plugin && npm install
	cd frontend && npm install

test:             ## 插件单测 + 后端编译检查
	cd plugin && npm test
	.venv/bin/python -m compileall -q backend/server.py
	node --check evals/run-evals.mjs
	node --check scripts/double-review.mjs
	bash -n data/scripts/demo.sh data/scripts/slow.sh

build:            ## 构建插件与前端
	cd plugin && npm run build
	cd frontend && npm run build

smoke:            ## 端到端冒烟（DRY_RUN 模式，无需 dsh）
	DRY_RUN=1 API_TOKEN=dev-token .venv/bin/python backend/server.py > /tmp/ar-server.log 2>&1 & \
	echo $$! > /tmp/ar-server.pid
	sleep 3
	API_TOKEN=dev-token node scripts/smoke.mjs; EXIT=$$?; \
	kill $$(cat /tmp/ar-server.pid) 2>/dev/null; exit $$EXIT

eval:             ## 评测门禁（需要 DEEPSEEK_API_KEY 与 dsh）
	DEEPSEEK_API_KEY=$${DEEPSEEK_API_KEY:?请设置 DEEPSEEK_API_KEY} node evals/run-evals.mjs

up:               ## Ubuntu 部署（Docker Compose）
	cd deploy && docker compose up -d --build

down:             ## 停止部署
	cd deploy && docker compose down
