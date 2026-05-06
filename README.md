\# Drawe FastAPI



CLIP 기반 텍스트/이미지 임베딩 서버입니다.



\## 역할



\- Drawe 백엔드 서비스의 임베딩 요청을 처리합니다.

\- CLIP ViT-Large/14 모델로 텍스트/이미지를 768차원 벡터로 변환합니다.

\- 결과 벡터는 Pinecone에 저장되거나 검색에 사용됩니다.



\## 스택



\- FastAPI + uvicorn

\- PyTorch + transformers

\- CLIP (`openai/clip-vit-large-patch14`)



\## 실행 방법



\### 1. 가상 환경 생성



```bash

python -m venv venv

```



\### 2. 가상 환경 활성화



```bash

\# Windows

.\\venv\\Scripts\\activate



\# Mac/Linux

source venv/bin/activate

```



\### 3. 의존성 설치



```bash

pip install -r requirements.txt

```



\### 4. 환경변수 설정



`.env.example`을 참고하여 `.env` 파일 생성:



```bash

cp .env.example .env

```



\### 5. 서버 실행



```bash

uvicorn main:app --host 0.0.0.0 --port 8000

```



\## API



\### POST `/embed/text`



텍스트를 768차원 벡터로 변환합니다.



\*\*Request\*\*

```json

{

&#x20; "text": "cherry blossoms spring"

}

```



\*\*Response\*\*

```json

{

&#x20; "vector": \[0.123, -0.456, ...]

}

```



\### POST `/embed/image`



이미지를 768차원 벡터로 변환합니다.



\### POST `/batch/load`



데이터 일괄 적재용 엔드포인트입니다 (1,000개 단위).



\## 의존 시스템



\- \*\*호출자\*\*: drawe-backend (Spring Boot)

\- \*\*모델\*\*: HuggingFace CLIP (`openai/clip-vit-large-patch14`)



\## 관련 레포



\- \[drawe-backend](https://github.com/DraWeTeam/drawe-backend)

\- \[drawe-frontend](https://github.com/DraWeTeam/drawe-frontend)

