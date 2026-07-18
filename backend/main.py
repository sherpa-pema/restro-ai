# TableCraft OS — FastAPI Backend (AI Proxy & Printer Server)
# File: backend/main.py

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
import requests
import json
import re
import sys
import io
from dotenv import load_dotenv

# Force UTF-8 encoding for standard output and error streams on Windows
# to prevent 'charmap' UnicodeEncodeError when printing emojis or unicode characters.
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except AttributeError:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Load environment variables from the root .env file
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), '.env')
load_dotenv(dotenv_path)


app = FastAPI(title="TableCraft OS Backend", version="1.0.0")

# Enable CORS for the Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins for local dev (Vite runs on port 3000)
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CEREBRAS_ENDPOINT = "https://api.cerebras.ai/v1/chat/completions"
CEREBRAS_MODEL = os.getenv("VITE_CEREBRAS_DEFAULT_MODEL", "gpt-oss-120b")
CEREBRAS_API_KEY = os.getenv("VITE_CEREBRAS_API_KEY")

NVIDIA_API_KEY = os.getenv("VITE_NVIDIA_API_KEY")
NVIDIA_MODEL = os.getenv("VITE_NVIDIA_MODEL", "nvidia/parakeet-tdt-0.6b-v2")

print(f"[Backend] Loaded Cerebras Model: {CEREBRAS_MODEL}")
print(f"[Backend] Loaded API Key Length: {len(CEREBRAS_API_KEY) if CEREBRAS_API_KEY else 0} characters")
print(f"[Backend] Loaded NVIDIA Model: {NVIDIA_MODEL}")
print(f"[Backend] Loaded NVIDIA API Key Length: {len(NVIDIA_API_KEY) if NVIDIA_API_KEY else 0} characters")

# ─────────────────────────────────────────────
# Pydantic Schemas
# ─────────────────────────────────────────────

class MenuItemSchema(BaseModel):
    name: str
    price: float

class AIParseRequest(BaseModel):
    command: str
    menu_items: List[MenuItemSchema]
    context: Optional[dict] = None

class ReceiptItem(BaseModel):
    name: str
    quantity: int
    price: float

class PrintRequest(BaseModel):
    order_id: str
    table_name: str
    currency: str
    subtotal: float
    tax: float
    service_charge: float
    discount: float
    total: float
    items: List[ReceiptItem]

# ─────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────

def build_system_prompt(menu_items: List[MenuItemSchema], context: Optional[dict] = None) -> str:
    menu_items_list = "\n".join([f"- {item.name} (${item.price:.2f})" for item in menu_items])
    
    context_str = ""
    if context:
        tables_str = ""
        for table in context.get("tables", []):
            items_str = f" ordering: {', '.join(table['items'])}" if table.get("items") else ""
            total_str = f" (total: {context['today_revenue']['currency']} {table['order_total']:.2f})" if table.get("order_total") else ""
            tables_str += f"- Table {table['name']} ({table['status']}){items_str}{total_str}\n"
            
        low_stock_str = ""
        for ing in context.get("low_stock_ingredients", []):
            low_stock_str += f"- {ing['name']}: {ing['stock']} {ing['unit']} left (threshold: {ing['threshold']} {ing['unit']})\n"
        if not low_stock_str:
            low_stock_str = "No low-stock ingredients.\n"
            
        rev = context.get("today_revenue", {})
        rev_str = f"- Net Sales Today: {rev.get('currency', 'NPR')} {rev.get('total', 0.0):.2f} (from {rev.get('transactions_count', 0)} transactions)\n"
        
        context_str = f"""
Current Restaurant Live Data:
Active Tables:
{tables_str}
Low-Stock Ingredients:
{low_stock_str}
Revenue:
{rev_str}"""
    
    return f"""You are an AI assistant for a restaurant POS system called TableCraft OS. Parse the user's natural language command and return a JSON object representing the intent.

Every JSON response object MUST include a "reply" field containing a friendly, conversational confirmation of the action in first person. E.g. "I've added 2 Chicken Burgers to table 3!" or "Table 5 is paid and closed."

If the user asks questions about the current state of the restaurant (e.g. active tables, occupied tables, or daily revenue/sales), return an intent with action "GET_STATUS" and target "all". Include a conversational "reply" like "Here's the current status of the restaurant for you!". For table-specific status, use target "table". For low stock queries, use action "CHAT" and a descriptive answer in the "message" field.

Available actions:
- ADD_ITEM: Add item(s) to a table's order. Fields: {{ "action": "ADD_ITEM", "table": number, "items": [{{ "name": string, "qty": number }}], "reply": string }}
- REMOVE_ITEM: Remove item from order. Fields: {{ "action": "REMOVE_ITEM", "table": number, "item_name": string, "reply": string }}
- PAY_TABLE: Pay and close a table. Fields: {{ "action": "PAY_TABLE", "table": number, "reply": string }}
- CLEAR_TABLE: Clear all items from a table. Fields: {{ "action": "CLEAR_TABLE", "table": number, "reply": string }}
- APPLY_DISCOUNT: Apply discount. Fields: {{ "action": "APPLY_DISCOUNT", "table": number, "discount_percent": number, "reply": string }}
- ADD_MENU_ITEM: Add new item to menu. Fields: {{ "action": "ADD_MENU_ITEM", "name": string, "price": number, "emoji": string, "reply": string }}
- DELETE_MENU_ITEM: Remove from menu. Fields: {{ "action": "DELETE_MENU_ITEM", "name": string, "reply": string }}
- GET_STATUS: Get status info. Fields: {{ "action": "GET_STATUS", "target": "table" | "revenue" | "all", "table": number (optional), "reply": string }}
- TRANSFER_TABLE: Transfer or move an order from one table to another. Fields: {{ "action": "TRANSFER_TABLE", "from_table": number, "to_table": number, "reply": string }}
- UPDATE_MENU_PRICE: Update or change the price of a menu item. Fields: {{ "action": "UPDATE_MENU_PRICE", "name": string, "price": number, "reply": string }}
- UPDATE_ITEM_QUANTITY: Change the exact quantity of an item already ordered (e.g., "Change the quantity of fries on table 2 to 4"). Note: for "add 1 more fries", use ADD_ITEM instead. Fields: {{ "action": "UPDATE_ITEM_QUANTITY", "table": number, "item_name": string, "qty": number, "reply": string }}

Available menu items:
{menu_items_list}
{context_str}"""

def parse_json_from_text(text: str) -> dict:
    # Try direct parse
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        pass
    
    # Try regex match to extract JSON block
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
            
    return {"action": "CHAT", "message": text}

# ─────────────────────────────────────────────
# Endpoint: AI Parser Proxy
# ─────────────────────────────────────────────

@app.post("/ai/parse")
async def ai_parse(req: AIParseRequest):
    if not CEREBRAS_API_KEY:
        raise HTTPException(status_code=500, detail="Cerebras API key not configured on backend")
        
    system_prompt = build_system_prompt(req.menu_items, req.context)
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {CEREBRAS_API_KEY}"
    }
    
    payload = {
        "model": CEREBRAS_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": req.command}
        ],
        "temperature": 0.1,
        "max_tokens": 2048
    }
    
    try:
        print(f"[Backend] Sending request to Cerebras Cloud for command: '{req.command}'")
        res = requests.post(CEREBRAS_ENDPOINT, headers=headers, json=payload, timeout=10)
        
        if res.status_code != 200:
            print(f"[Backend] Cerebras returned status {res.status_code}: {res.text}")
            raise HTTPException(status_code=res.status_code, detail=f"Cerebras API returned: {res.text}")
            
        data = res.json()
        print(f"[Backend] Cerebras Response Body:\n{json.dumps(data, indent=2)}")
        
        choices = data.get("choices")
        if not choices or len(choices) == 0:
            print("[Backend] Error: No choices in Cerebras response")
            return {"action": "UNKNOWN", "message": "No response options from Cerebras"}
            
        message = choices[0].get("message")
        if not message:
            print("[Backend] Error: No message in Cerebras choice")
            return {"action": "UNKNOWN", "message": "No message body in Cerebras choice"}
            
        content = message.get("content")
        if not content:
            print("[Backend] Error: Empty content in Cerebras message")
            return {"action": "UNKNOWN", "message": "Empty content in Cerebras response"}
            
        print(f"[Backend] Raw Cerebras Content:\n{content}")
        parsed_intent = parse_json_from_text(content)
        
        # Sanitize intent to ensure it is compatible with frontend command executor
        if not isinstance(parsed_intent, dict):
            parsed_intent = {"action": "CHAT", "message": str(parsed_intent)}
            
        if "action" not in parsed_intent:
            if "reply" in parsed_intent:
                parsed_intent["action"] = "CHAT"
                parsed_intent["message"] = parsed_intent["reply"]
            elif "message" in parsed_intent:
                parsed_intent["action"] = "CHAT"
            else:
                parsed_intent["action"] = "UNKNOWN"
                parsed_intent["message"] = "Could not parse intent from Cerebras response"
                
        if parsed_intent.get("action") == "CHAT" and "message" not in parsed_intent:
            parsed_intent["message"] = parsed_intent.get("reply", "No message content")
            
        print(f"[Backend] Sanitized Intent: {parsed_intent}")
        return parsed_intent
        
    except requests.exceptions.Timeout:
        raise HTTPException(status_code=504, detail="Request to Cerebras API timed out")
    except Exception as e:
        print(f"[Backend] Error processing AI command: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")



# ─────────────────────────────────────────────
# Endpoint: Print Receipt Server
# ─────────────────────────────────────────────

@app.post("/print")
async def print_receipt(req: PrintRequest):
    try:
        # Create receipts folder if not exists
        receipts_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "receipts")
        os.makedirs(receipts_dir, exist_ok=True)
        
        # Structure receipt content
        receipt_filename = f"receipt_{req.order_id[:8]}.txt"
        receipt_path = os.path.join(receipts_dir, receipt_filename)
        
        currency_symbols = {"NPR": "Rs.", "INR": "Rs.", "USD": "$"}
        symbol = currency_symbols.get(req.currency, req.currency)
        
        receipt_txt = f"""
========================================
             TABLECRAFT OS              
           RECEIPT OF PAYMENT           
========================================
Table: {req.table_name}
Order ID: {req.order_id}
Date/Time: {req.timestamp if hasattr(req, 'timestamp') else 'Just Now'}
----------------------------------------
"""
        for item in req.items:
            item_total = item.quantity * item.price
            receipt_txt += f"{item.name:<25} {item.quantity}x {symbol}{item.price:.2f} = {symbol}{item_total:.2f}\n"
            
        receipt_txt += f"""----------------------------------------
Subtotal:                {symbol}{req.subtotal:.2f}
VAT (10%):               {symbol}{req.tax:.2f}
Service Charge (5%):     {symbol}{req.service_charge:.2f}
"""
        if req.discount > 0:
            receipt_txt += f"Discount:               -{symbol}{req.discount:.2f}\n"
            
        receipt_txt += f"""----------------------------------------
TOTAL PAID:              {symbol}{req.total:.2f}
========================================
       THANK YOU FOR YOUR VISIT!        
========================================
"""
        # Save print receipt to local text file
        with open(receipt_path, "w", encoding="utf-8") as f:
            f.write(receipt_txt)
            
        print(f"[Backend] Receipt printed successfully to: {receipt_path}")
        return {"success": True, "message": f"Printed successfully to receipts/{receipt_filename}"}
        
    except Exception as e:
        print(f"[Backend] Print Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to print receipt: {str(e)}")
