.PHONY: init up production down logs ps health backup preflight preflight-build

init:
	./scripts/init.sh

up:
	docker compose up -d --build

production:
	docker compose -f docker-compose.production.yml up -d --build

down:
	docker compose down
	docker compose -f docker-compose.production.yml down

logs:
	docker compose logs -f --tail=200

ps:
	docker compose ps

health:
	curl -fsS http://127.0.0.1/api/health

backup:
	./scripts/backup.sh

preflight:
	./scripts/prepare-github.sh

preflight-build:
	./scripts/prepare-github.sh --build
