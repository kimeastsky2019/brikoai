# API 키 등록 가이드

로컬 LLM(Ollama) 장애 시 자동 전환할 클라우드 폴백의 키를 넣는 방법입니다.

**키를 넣는 곳은 서버의 파일 딱 하나입니다.**

```
/opt/rag-ai-gov/Rag-extended/.env
```

> 로컬 맥의 프로젝트 폴더에는 넣지 마세요. 그쪽 `.env.example`은 형식만 보여주는 견본이고, 실제로 읽히지 않습니다. 또 로컬 소스를 서버로 rsync해도 `.env`는 덮어쓰지 않도록 되어 있습니다.

---

## 1. 파일 열기

```bash
ssh -i /Users/donghokim/Documents/Webpage/ETS/dhkim-key.pem ubuntu@211.119.38.216
sudo nano /opt/rag-ai-gov/Rag-extended/.env
```

파일 아래쪽에 이런 구역이 있습니다.

```ini
# [Fallback 1] Grok / xAI
XAI_API_KEY=xai-...(등록됨)
XAI_MODEL=grok-4.20-0309-non-reasoning

# [Fallback 2] ChatGPT / OpenAI  — 사용하려면 주석 해제 후 키 입력
# OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

# [Fallback 3] Claude / Anthropic — 사용하려면 주석 해제 후 키 입력
# ANTHROPIC_API_KEY=
CLAUDE_MODEL=claude-haiku-4-5-20251001
```

---

## 2. 키 종류별 위치

키는 앞글자로 구분됩니다. **해당 줄의 `#`을 지우고 `=` 뒤에 붙여 넣으면 됩니다.**

| 키 형태 | 발급처 | 넣을 줄 |
|---|---|---|
| `xai-`로 시작 | xAI (Grok) | `XAI_API_KEY=` |
| `sk-`로 시작 | OpenAI (ChatGPT) | `OPENAI_API_KEY=` |
| `sk-ant-`로 시작 | Anthropic (Claude) | `ANTHROPIC_API_KEY=` |

### 예시 — 키가 `xai-AbCdEf0123456789GhIjKlMnOpQrStUvWxYz0123456789AbCd` 인 경우

`xai-`로 시작하므로 **Grok** 자리입니다.

**수정 전**

```ini
# [Fallback 1] Grok / xAI
XAI_API_KEY=xai-이전키값
XAI_MODEL=grok-4.20-0309-non-reasoning
```

**수정 후**

```ini
# [Fallback 1] Grok / xAI
XAI_API_KEY=xai-AbCdEf0123456789GhIjKlMnOpQrStUvWxYz0123456789AbCd
XAI_MODEL=grok-4.20-0309-non-reasoning
```

### 예시 — 키가 `sk-proj-AbCdEf...` 인 경우

`sk-`로 시작하므로 **ChatGPT** 자리이고, 지금은 주석 처리되어 있으니 `#`을 지웁니다.

**수정 전**

```ini
# [Fallback 2] ChatGPT / OpenAI  — 사용하려면 주석 해제 후 키 입력
# OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

**수정 후**

```ini
# [Fallback 2] ChatGPT / OpenAI
OPENAI_API_KEY=sk-proj-AbCdEf...
OPENAI_MODEL=gpt-4o-mini
```

### 작성 규칙

- `=` 앞뒤에 **공백을 넣지 마세요** → `XAI_API_KEY = xai-...` (✗)
- 따옴표를 **씌우지 마세요** → `XAI_API_KEY="xai-..."` (✗)
- 줄 맨 앞의 `#`은 그 줄 전체를 무시한다는 뜻입니다. 키를 넣었는데 적용이 안 되면 `#`이 남아 있는지 먼저 확인하세요

---

## 3. 저장 후 반영

nano 기준: `Ctrl+O` → `Enter` (저장) → `Ctrl+X` (종료)

```bash
sudo systemctl restart rag-api
```

**재시작해야 반영됩니다.** 파일만 고치면 아무 일도 일어나지 않습니다.

---

## 4. 등록 확인

```bash
curl -s http://127.0.0.1:8000/health | python3 -m json.tool
```

`llm.available` 목록에 이름이 추가되었는지 봅니다.

```json
{
  "llm": {
    "active_provider": "exo",
    "available": ["exo", "grok"],          ← 여기에 openai, claude 가 붙습니다
    "providers": {
      "exo":    { "state": "closed", "available": true  },
      "grok":   { "state": "closed", "available": true  },
      "openai": { "state": "closed", "available": false },  ← 키 미등록
      "claude": { "state": "closed", "available": false }
    }
  }
}
```

- `available: true` — 키가 인식됨
- `available: false` — 키가 비었거나 `#`이 남아 있음
- `state: "closed"` — 정상 / `"open"` — 장애로 차단된 상태

---

## 5. 키가 진짜 동작하는지 확인 (중요)

`available: true`는 **키 문자열이 채워졌다는 뜻일 뿐**, 그 키가 유효한지도 모델명이 맞는지도 검사하지 않습니다. 실제로 불러 봐야 압니다.

```bash
# Grok
curl -s -H "Authorization: Bearer $XAI_KEY" https://api.x.ai/v1/models | python3 -m json.tool

# ChatGPT
curl -s -H "Authorization: Bearer $OPENAI_KEY" https://api.openai.com/v1/models | python3 -m json.tool
```

여기서 나온 모델 목록에 `.env`의 `XAI_MODEL` / `OPENAI_MODEL` 값이 실제로 있어야 합니다.

> 실제로 겪은 문제입니다. 초기 기본값이던 `grok-3-mini`는 이 계정에서 제공되지 않는 모델이라, 그대로 뒀다면 평소에는 멀쩡하다가 **정작 로컬이 죽어 폴백이 필요한 순간에 함께 실패**했을 겁니다. 키를 바꿀 때는 모델명도 같이 확인하세요.

---

## 6. 폴백 동작 시험

키를 넣은 뒤 실제 전환까지 보려면, 로컬 LLM을 잠시 죽여서 확인합니다.

```bash
E=/opt/rag-ai-gov/Rag-extended/.env
sudo cp $E $E.bak

# 로컬 엔드포인트를 없는 포트로 돌림
sudo sed -i 's|^EXO_BASE_URL=.*|EXO_BASE_URL=http://127.0.0.1:59999/v1|' $E
sudo systemctl restart rag-api && sleep 8

# 질의 → 폴백이 답해야 정상
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/token \
  -d "username=info@gngmeta.com&password=admin1234" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s -X POST http://127.0.0.1:8000/chat -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"테스트","collection_id":1}'

curl -s http://127.0.0.1:8000/health | python3 -m json.tool   # active_provider 확인

# 반드시 원복
sudo mv $E.bak $E && sudo chown ragai:ragai $E && sudo chmod 600 $E
sudo systemctl restart rag-api
```

원복 후 `active_provider`가 `exo`로 돌아오면 정상입니다.

---

## 7. 보안 주의

- `.env`는 `ragai` 소유 / 권한 `600`이어야 합니다. 확인:
  ```bash
  sudo ls -l /opt/rag-ai-gov/Rag-extended/.env
  # -rw------- 1 ragai ragai
  ```
- **키를 채팅·메신저·이슈에 붙여 넣지 마세요.** 기록에 평문으로 남습니다. 위 방법대로 서버에서 직접 입력하는 것이 안전합니다.
- 노출된 키는 발급처 콘솔에서 폐기(revoke)하고 새로 발급하세요.
  - xAI: https://console.x.ai
  - OpenAI: https://platform.openai.com/api-keys
  - Anthropic: https://console.anthropic.com

## 8. 비용

폴백은 로컬 장애 시에만 호출되지만, 회로가 열려 있는 동안(`CB_RECOVERY_SEC=60`초)의 요청은 전부 유료 API로 갑니다. CrewAI 3-에이전트 모드는 질의 1건에 LLM을 여러 번 부르므로 이 구간에서 사용량이 빠르게 늘 수 있습니다. 기본 모델을 저비용 등급(`grok-4.20-0309-non-reasoning`, `gpt-4o-mini`)으로 잡아 둔 이유입니다.
