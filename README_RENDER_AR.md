# GridGate v0.9 — تشغيل Cloudflare وRender بالتوازي

هذه النسخة لا تحذف Cloudflare. نفس الواجهة ونفس Game Engine يمكن تشغيلهما بطريقتين:

- Cloudflare Workers + Durable Objects: رابط `workers.dev` الحالي.
- Render Free Web Service: رابط مستقل `onrender.com` بخادم Node.js + Express + WebSocket (`ws`).

## 1) التجربة المحلية لخادم Render

من داخل مجلد المشروع:

```bat
npm install
npm test
npm run dev:render
```

ثم افتح:

```text
http://localhost:10000
```

أو شغّل `START_RENDER_LOCAL.bat`.

> هذه التجربة تستخدم خادم Render-style محليًا، وليست Wrangler أو Durable Objects.

## 2) إبقاء Cloudflare كما هو

للتطوير المحلي على Cloudflare:

```bat
npm run dev:cloudflare
```

لرفع Cloudflare:

```bat
npm run deploy:cloudflare
```

الرابط الحالي `workers.dev` يظل يعمل. لا تحتاج حذف Worker أو Durable Objects.

## 3) نشر Render — الطريقة الموصى بها

Render يبني Web Service من Git repository. ارفع هذا المجلد إلى GitHub/GitLab/Bitbucket، ثم:

1. افتح Render Dashboard.
2. اختر `New` ثم `Web Service`.
3. اربط المستودع الذي يحتوي المشروع.
4. اختر الفرع الذي رفعت إليه المشروع.
5. Runtime: `Node`.
6. Build Command: `npm install`.
7. Start Command: `npm start`.
8. Instance Type / Plan: `Free`.
9. Health Check Path: `/api/health`.
10. أنشئ الخدمة.

يوجد أيضًا `render.yaml` في المشروع، لذلك تستطيع استخدام Render Blueprint بدل إدخال الإعدادات يدويًا إذا رغبت.

بعد اكتمال النشر سيظهر رابط شبيه:

```text
https://gridgate-game-xxxx.onrender.com
```

افتح `/api/health` للتأكد. يجب أن ترى `backend: "render-node"` و`version: "0.9.0"`.

## 4) الاختبار الصحيح بين Cloudflare وRender

استخدم نفس الأجهزة والأشخاص الذين كانت لديهم مشكلة QUIC مع `workers.dev`:

- افتح رابط Cloudflare عدة مرات مع QUIC مفعّل.
- افتح رابط Render عدة مرات مع QUIC مفعّل.
- أنشئ غرفة من PC وانضم من الهاتف.
- أنشئ غرفة من الهاتف وانضم من PC.
- اختبر PC ↔ PC إن أمكن.
- اترك مباراة جارية أكثر من 15 دقيقة مع حركات/WebSocket messages: Render لا يفترض أن ينام ما دام يستقبل traffic.

## 5) فرق مهم في حفظ الغرف على Render Free

نسخة Render الحالية تحفظ الغرف في RAM فقط. هذا مقصود للاختبار والهواية:

- أثناء تشغيل الخدمة: الغرف تعمل طبيعيًا.
- إذا Render أعاد تشغيل الخدمة أو نامت الخدمة بعد الخمول: RAM تُمسح والغرف القديمة تختفي.
- المباراة النشطة ترسل WebSocket traffic، وهذا يمنع الـFree service من النوم بسبب الخمول.
- إذا أنشأت غرفة وتركتها بلا أي traffic لمدة طويلة ثم نام الخادم، يجب إنشاء غرفة جديدة بعد الاستيقاظ.

لا يؤثر ذلك على Cloudflare؛ Durable Objects تبقى مستقلة تمامًا.

## 6) أول دخول بعد Sleep

Render Free ينام بعد 15 دقيقة بلا inbound traffic. أول HTTP request أو WebSocket connection يوقظه، وقد يستغرق قرابة دقيقة. Render يعرض loading أثناء الاستيقاظ.

إذا كان السيرفر مستيقظًا، الاستخدام طبيعي مباشرة.

## 7) أوامر مختصرة

```bat
npm install
npm test

:: Render local
npm run dev:render

:: Cloudflare local
npm run dev:cloudflare

:: Cloudflare deploy
npm run deploy:cloudflare

:: Render production start command (Render يشغله تلقائيًا)
npm start
```

## 8) ملاحظة أمنية/معمارية

العميل لا يقرر صحة الحركات في Online. خادم Render يستعمل نفس `applyAction()` وBFS والقواعد الموجودة في `public/shared/game-engine.js`، تمامًا كما يفعل Backend Cloudflare.


## تحسينات AI في v0.9
- اختيار الجدران أصبح مبنيًا على أقصر مسار فعلي للخصم.
- تقييم الجدار يحسب مقدار إطالة طريق الخصم مقابل الضرر على طريق الـAI.
- دفاع طارئ إذا كان الخصم على بعد حركة أو حركتين من الفوز.
- Veteran وExpert يستخدمان Alpha-Beta مرتبًا مع Iterative Deepening وTransposition Table.
- Expert محدود بميزانية بحث حتى يبقى خفيفًا على المتصفح.
- توجد عقوبة واضحة للتراجع غير المفيد.
- عندما يكون الـAI متقدمًا بوضوح، يوفر الجدران ويتجه للفوز بدل إهدارها.
