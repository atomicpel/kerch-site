#!/usr/bin/env python3
"""Узнать свой user_id в MAX.

1. Откройте своего бота в MAX и напишите ему любое сообщение.
2. Запустите: python3 get_user_id.py
3. Впишите найденный user_id в .env как MAX_USER_ID.
"""
import sys
import urllib.error

import server


def walk(obj, found):
    """Ищет в ответе пары имя + user_id, где бы они ни лежали."""
    if isinstance(obj, dict):
        uid = obj.get("user_id")
        if isinstance(uid, int) and not obj.get("is_bot"):
            name = " ".join(filter(None, [obj.get("first_name"), obj.get("last_name")])) or obj.get("name") or "?"
            found[uid] = name
        for v in obj.values():
            walk(v, found)
    elif isinstance(obj, list):
        for v in obj:
            walk(v, found)


def main():
    if not server.MAX_TOKEN:
        print("Сначала впишите MAX_TOKEN в .env")
        sys.exit(1)
    print("Жду сообщений боту (до 30 секунд)...")
    try:
        me = server.max_request("GET", "/me")
        bot_id = me.get("user_id")
        data = server.max_request("GET", "/updates", {"timeout": 30, "limit": 100}, timeout=40)
    except urllib.error.HTTPError as e:
        print(f"Ошибка {e.code}: {e.read().decode('utf-8', 'replace')}")
        sys.exit(1)
    found = {}
    walk(data.get("updates", []), found)
    found.pop(bot_id, None)
    if not found:
        print("Сообщений не найдено. Напишите боту ещё раз и повторите.")
        return
    for uid, name in found.items():
        print(f"{name}: MAX_USER_ID={uid}")


if __name__ == "__main__":
    main()
