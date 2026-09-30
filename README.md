# Balancer Watch

Локальный сервис для совместного просмотра: плеер, комнаты, синхронизация, чат и WebRTC-голос.

## Файлы

- `index.html` — клиентский интерфейс.
- `server.js` — локальный WebSocket-сервер комнат, чата и WebRTC-сигналинга.
- `package.json` — зависимость `ws` и команда запуска.
- `balancer-watch.service` — systemd-сервис с автоперезапуском.
- `Caddyfile.snippet` — изолированный Caddy-блок для домена и `/ws`.

## Локальный запуск

```bash
npm install
npm start
```

Сервер слушает `127.0.0.1:8765`.

## Развёртывание на Ubuntu

```bash
sudo useradd --system --home-dir /opt/balancer-watch --shell /usr/sbin/nologin balancerwatch
sudo mkdir -p /opt/balancer-watch
sudo cp server.js package.json /opt/balancer-watch/
cd /opt/balancer-watch
sudo npm install --omit=dev --no-audit --no-fund
sudo chown -R balancerwatch:balancerwatch /opt/balancer-watch
sudo cp balancer-watch.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now balancer-watch
```

Caddy должен проксировать `https://<домен>/ws*` на `127.0.0.1:8765`, а остальные запросы отдавать из каталога с `index.html`. Для WebSocket необходим HTTPS.

## Ссылка на фильм

```text
https://<домен>/film=https://gorodyshka.link/balancer-api/iframe?movie_id=632&token=<TOKEN>
```

При первом входе вводится имя. Имя, текущая комната и фильм сохраняются в браузере; клиент переподключается автоматически.

## Проверка

```bash
curl http://127.0.0.1:8765/health
sudo systemctl status balancer-watch
```
