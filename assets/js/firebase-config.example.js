// انسخ هذا الملف إلى assets/js/firebase-config.js (نفس المجلد) واملأ القيم من إعدادات مشروعك في Firebase.
// firebase-config.js غير موجود في المستودع عمداً (.gitignore) — التطبيق يعمل محلياً بشكل طبيعي بدونه،
// ويظهر قسم "مزامنة السحابة" فقط بعد أن يجد هذا الملف.
//
// طريقة الحصول على هذه القيم: راجع FIREBASE_SETUP.md في جذر المستودع.
//
// ملاحظة أمان: قيم Firebase Web Config هذه (apiKey ...) ليست سرّية بطبيعتها في تطبيقات الويب —
// الحماية الحقيقية تأتي من قواعد Firestore (firestore.rules) ومن تفعيل Authentication، وليس من
// إخفاء هذا الملف. مع ذلك أبقيناه خارج المستودع حسب طلبك حتى لا يُنشر رقم مشروعك علناً على GitHub.

export const firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE_PROJECT_ID.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID"
};
