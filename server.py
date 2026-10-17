#!/usr/bin/env python3
"""Сайт + приём заявок с уведомлением в MAX.

Только стандартная библиотека Python 3.8+, ничего ставить не нужно.

Запуск:            python3 server.py
Тестовое сообщение: python3 server.py --test
"""
import json
import os
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone, timedelta
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
LEADS_FILE = os.path.join(BASE_DIR, "leads.jsonl")
MSK = timezone(timedelta(hours=3))


def load_env(path):
    """Читает .env (KEY=VALUE) в os.environ, не перетирая уже заданные переменные."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env(os.path.join(BASE_DIR, ".env"))

MAX_TOKEN = os.environ.get("MAX_TOKEN", "")
MAX_USER_ID = os.environ.get("MAX_USER_ID", "")
MAX_CHAT_ID = os.environ.get("MAX_CHAT_ID", "")
MAX_API_BASE = os.environ.get("MAX_API_BASE", "https://platform-api2.max.ru").rstrip("/")
MAX_CA_FILE = os.environ.get("MAX_CA_FILE", "")
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8080"))
TRUST_PROXY = os.environ.get("TRUST_PROXY", "1") == "1"

RATE_LIMIT = 5          # заявок
RATE_WINDOW = 600       # за 10 минут с одного IP
_hits = {}
_lock = threading.Lock()


def ssl_context():
    ctx = ssl.create_default_context()
    if MAX_CA_FILE:
        ctx.load_verify_locations(MAX_CA_FILE)
    return ctx


def max_request(method, path, params=None, body=None, timeout=15):
    url = MAX_API_BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", MAX_TOKEN)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_context()) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def send_to_max(text):
    if not MAX_TOKEN:
        raise RuntimeError("MAX_TOKEN не задан в .env")
    if MAX_USER_ID:
        params = {"user_id": MAX_USER_ID}
    elif MAX_CHAT_ID:
        params = {"chat_id": MAX_CHAT_ID}
    else:
        raise RuntimeError("Не задан MAX_USER_ID (или MAX_CHAT_ID) в .env")
    return max_request("POST", "/messages", params, {"text": text[:4000]})


def rate_limited(ip):
    now = time.time()
    with _lock:
        hits = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW]
        limited = len(hits) >= RATE_LIMIT
        if not limited:
            hits.append(now)
        _hits[ip] = hits
        return limited


def clean(value, limit):
    return " ".join(str(value or "").split())[:limit]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=PUBLIC_DIR, **kw)

    def client_ip(self):
        if TRUST_PROXY:
            ip = self.headers.get("X-Real-IP") or self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            if ip:
                return ip
        return self.client_address[0]

    def reply(self, code, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != "/api/lead":
            return self.reply(404, {"error": "Не найдено"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 10_000:
            return self.reply(400, {"error": "Некорректный запрос"})
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError
        except Exception:
            return self.reply(400, {"error": "Некорректный запрос"})

        if data.get("website"):  # ловушка для ботов: тихо делаем вид, что всё ок
            return self.reply(200, {"ok": True})

        name = clean(data.get("name"), 80)
        phone = clean(data.get("phone"), 20)
        obj = clean(data.get("object"), 60)
        comment = clean(data.get("comment"), 1000)
        digits = "".join(c for c in phone if c.isdigit())
        if not name:
            return self.reply(400, {"error": "Укажите имя."})
        if not 10 <= len(digits) <= 15:
            return self.reply(400, {"error": "Проверьте номер телефона."})

        ip = self.client_ip()
        if rate_limited(ip):
            return self.reply(429, {"error": "Слишком много заявок. Позвоните: 8 989 629-69-39."})

        when = datetime.now(MSK).strftime("%d.%m.%Y %H:%M")
        lead = {"time": when, "name": name, "phone": phone, "object": obj, "comment": comment, "ip": ip}
        with _lock, open(LEADS_FILE, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(lead, ensure_ascii=False) + "\n")

        text = (
            "Новая заявка с сайта\n\n"
            f"Имя: {name}\n"
            f"Телефон: {phone}\n"
            f"Объект: {obj or '-'}\n"
            + (f"Комментарий: {comment}\n" if comment else "")
            + f"\n{when}"
        )
        try:
            send_to_max(text)
        except Exception as e:  # заявка всё равно сохранена в leads.jsonl
            sys.stderr.write(f"[MAX] не удалось отправить уведомление: {e}\n")
        return self.reply(200, {"ok": True})

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.client_ip(), fmt % args))


def main():
    if "--test" in sys.argv:
        try:
            send_to_max("Проверка: уведомления с сайта работают.")
            print("Отправлено. Проверьте MAX.")
        except urllib.error.HTTPError as e:
            print(f"Ошибка {e.code}: {e.read().decode('utf-8', 'replace')}")
            sys.exit(1)
        except Exception as e:
            print(f"Ошибка: {e}")
            sys.exit(1)
        return
    if not MAX_TOKEN or not (MAX_USER_ID or MAX_CHAT_ID):
        print("Внимание: MAX не настроен, заявки будут только сохраняться в leads.jsonl")
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Сайт: http://{HOST}:{PORT}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
