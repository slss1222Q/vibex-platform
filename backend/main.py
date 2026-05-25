from __future__ import annotations
import os
import secrets
import sqlite3
import json
import threading
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from fastapi import FastAPI

# Botni alohida thread'da xavfsiz ishga tushirish
def run_telegram_bot():
    try:
        print("Telegram bot polling starting...")
        # bot obyekti shu faylning pastrog'ida yaratilgan bo'lsa, 
        # u funksiyadan pastda bo'lsa ham muammo bo'lmaydi
        bot.infinity_polling(skip_pending=True)
    except Exception as e:
        print(f"Bot error: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Botni orqa fonda start qilamiz
    bot_thread = threading.Thread(target=run_telegram_bot, daemon=True)
    bot_thread.start()
    print("Background bot thread started successfully.")
    yield
    print("Shutting down applications...")

# FastAPI obyektini yaratish (ESKI app = FastAPI() qatorini o'chirib, shuni qo'ying)
app = FastAPI(lifespan=lifespan)
