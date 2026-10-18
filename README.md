# Личный сайт-портфолио Павла с формой обратной связи в MAX

Некоммерческий сайт о проектах. Сообщение из формы приходит в MAX и сохраняется в `leads.jsonl`, поэтому не потеряется, даже если MAX недоступен.

Нужен только Python 3.8+ (есть на любом Linux-VPS), ставить ничего не надо.

## Что в архиве

- `public/index.html` — сам сайт
- `server.py` — отдаёт сайт и принимает заявки
- `get_user_id.py` — помогает узнать ваш user_id в MAX
- `.env.example` — шаблон настроек
- `deploy/` — готовые настройки systemd и nginx

## 1. Бот в MAX

Бот создаётся на платформе для партнёров MAX (business.max.ru), доступ к ней есть у самозанятых, ИП и организаций. Токен берётся в настройках бота.

**Не пересылайте токен в чаты, включая этот.** Он хранится только в файле `.env` на сервере.

## 2. Загрузка на сервер

```bash
sudo git clone https://github.com/atomicpel/kerch-site.git /opt/kerch-site
cd /opt/kerch-site
cp .env.example .env
nano .env          # впишите MAX_TOKEN
```

## 3. Ваш user_id

1. Откройте своего бота в MAX и напишите ему что угодно.
2. Запустите `python3 get_user_id.py` и впишите показанный номер в `.env` как `MAX_USER_ID`.
3. Проверьте отправку: `python3 server.py --test` — в MAX должно прийти сообщение.

Если `get_user_id.py` ничего не находит, а у бота настроен webhook, отключите webhook в настройках бота.

## 4. Если ошибка сертификата (CERTIFICATE_VERIFY_FAILED)

API MAX работает на сертификате Минцифры. Скачайте корневой сертификат «Russian Trusted Root CA» на gosuslugi.ru/crt в формате PEM, положите в `/opt/kerch-site/` и укажите путь в `.env`:

```
MAX_CA_FILE=/opt/kerch-site/russian_trusted_root_ca.pem
```

Обновление сайта в будущем:

```bash
cd /opt/kerch-site && sudo git -c safe.directory=/opt/kerch-site pull && sudo systemctl restart kerch-site
```

`.env` и `leads.jsonl` в репозиторий не попадают, поэтому `git pull` их не затронет.

## 5. Автозапуск и домен

Сейчас сайт работает на https://s.atomicpel.cloud-ip.cc через Caddy (блок из `deploy/Caddyfile.snippet` дописан в конец `/etc/caddy/Caddyfile`, применение: `sudo systemctl reload caddy`). Вариант с nginx ниже — на случай другого сервера.

```bash
sudo chown -R www-data:www-data /opt/kerch-site
sudo chmod 600 /opt/kerch-site/.env
sudo cp deploy/kerch-site.service /etc/systemd/system/
sudo systemctl enable --now kerch-site

sudo cp deploy/nginx.conf /etc/nginx/sites-available/kerch-site
sudo nano /etc/nginx/sites-available/kerch-site   # впишите домен
sudo ln -s /etc/nginx/sites-available/kerch-site /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ВАШ-ДОМЕН
```

Логи: `journalctl -u kerch-site -f`. Все заявки: `cat /opt/kerch-site/leads.jsonl`.

## Защита от спама

- Скрытое поле-ловушка: боты его заполняют, и такие заявки отбрасываются.
- Не больше 5 заявок за 10 минут с одного IP.
- Проверка имени и номера телефона, ограничение длины полей.

## Персональные данные

- `public/privacy.html` — политика обработки ПДн, `public/consent.html` — отдельный текст согласия.
- Форма не отправится без галочки согласия; сервер тоже проверяет её и сохраняет в `leads.jsonl` отметку о согласии, его редакцию, время, IP и браузер.
- Заявки старше 365 дней удаляются автоматически (как указано в политике).
- Шрифты подключены с самого сайта, без Google Fonts, cookie и аналитики нет.

## Что заменить на сайте

- `public/privacy.html` и `public/consent.html`: `[Фамилия]` и `[EMAIL]` для обращений по персональным данным.
- Тексты проектов — в `public/index.html`, блоки `#cams`, `#rtspatom`, `#matrix`, `#site`.
