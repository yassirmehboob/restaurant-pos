// Guest QR menu wording. Menu item names stay as the restaurant typed them; only the screens are translated.
export const QR_LANGUAGES=["en","ur","sd"] as const;
export type QrLanguage=(typeof QR_LANGUAGES)[number];
export const QR_LANGUAGE_NAMES:Record<QrLanguage,string>={en:"English",ur:"اردو",sd:"سنڌي"};
export const isRtl=(language:QrLanguage)=>language!=="en";

const en={
 welcome:"Welcome to",table:"Table",intro:"Choose your food, add it to the cart and send the order. Our waiter will confirm it with you.",
 search:"Search the menu",all:"All",Deals:"Deals",Menu:"Menu",noItems:"No items found",
 add:"Add",inCart:"in cart",increase:"Add one more",decrease:"Remove one",chooseWeight:"Choose weight",perKg:"per KG",
 viewCart:"View order",items:"items",item:"item",yourOrder:"Your order",emptyCart:"Your cart is empty. Add something tasty from the menu.",
 note:"Note for the kitchen (optional)",notePlaceholder:"e.g. less spicy",remove:"Remove",backToMenu:"Back to menu",continue:"Continue",
 yourDetails:"Your details",detailsIntro:"We use your mobile number only to send you updates about this order.",name:"Your name",namePlaceholder:"e.g. Ali Khan",
 phone:"Mobile number",phonePlaceholder:"e.g. 0300 1234567",confirmOrder:"Confirm order",sending:"Sending…",back:"Back",
 itemName:"Item Name",price:"Price",qty:"Qty",amount:"Amount",subtotal:"Subtotal",tax:"Tax",discount:"Discount",total:"Total",finalBill:"The cashier will give you the final bill.",
 thanks:"Thank you",waiterWillConfirm:"Our waiter will confirm your order in just 2 minutes.",smsUpdates:"You will also get updates by SMS.",
 orderStatus:"Order status",orderNumber:"Order no.",orderMore:"Order something else",paid:"Paid",
 stage_WAITING:"Waiting for the waiter to confirm",stage_CONFIRMED:"Confirmed — sent to the kitchen",stage_PREPARING:"Being prepared",stage_READY:"Ready to serve",stage_SERVED:"Served — enjoy your meal!",stage_COMPLETED:"Completed — thank you for visiting!",stage_CANCELLED:"This order was cancelled. Please ask our staff for help.",
 error_INVALID:"This QR code is not valid. Please scan the code on your table again.",error_CLOSED:"QR ordering is not available right now. Please ask our waiter.",error_COUNTER_CLOSED:"We are not taking table orders right now because our counter is closed.",
 error_BUSY:"Too many orders at once. Please wait a few minutes and try again.",error_LIMIT:"You already have orders waiting. Our waiter will be with you shortly.",
 error_NAME:"Please enter your name.",error_PHONE:"Please enter a valid mobile number, e.g. 0300 1234567.",error_EMPTY:"Your cart is empty.",
 error_UNAVAILABLE:"An item is no longer available. Please remove it and try again.",error_ERROR:"Could not send your order. Check your internet and try again.",
 verifyTitle:"Verify your mobile number",verifySent:"We sent a 4-digit code by SMS to",code:"Code",verifyButton:"Verify and send order",verifying:"Checking…",
 resend:"Send the code again",resendIn:"Send again in",seconds:"s",changeNumber:"Change number",verifyOnce:"You only need to do this once on this phone.",
 error_CODE:"That code is not right. Please check the SMS and try again.",error_EXPIRED:"This code has expired. Please send a new one.",
 language:"Language",poweredBy:"Software developed by: Cubedevsys.com",
};
export type QrText=typeof en;

const ur:QrText={
 welcome:"خوش آمدید",table:"ٹیبل",intro:"اپنا کھانا چنیں، کارٹ میں شامل کریں اور آرڈر بھیجیں۔ ہمارا ویٹر آپ سے آرڈر کی تصدیق کرے گا۔",
 search:"مینو میں تلاش کریں",all:"سب",Deals:"ڈیلز",Menu:"مینو",noItems:"کوئی آئٹم نہیں ملا",
 add:"شامل کریں",inCart:"کارٹ میں",increase:"ایک اور شامل کریں",decrease:"ایک کم کریں",chooseWeight:"وزن چنیں",perKg:"فی کلو",
 viewCart:"آرڈر دیکھیں",items:"آئٹمز",item:"آئٹم",yourOrder:"آپ کا آرڈر",emptyCart:"آپ کا کارٹ خالی ہے۔ مینو سے کچھ مزیدار شامل کریں۔",
 note:"کچن کے لیے ہدایت (اختیاری)",notePlaceholder:"مثلاً کم مرچ",remove:"ہٹائیں",backToMenu:"مینو پر واپس",continue:"آگے بڑھیں",
 yourDetails:"آپ کی معلومات",detailsIntro:"آپ کا موبائل نمبر صرف اس آرڈر کی اطلاع بھیجنے کے لیے استعمال ہوگا۔",name:"آپ کا نام",namePlaceholder:"مثلاً علی خان",
 phone:"موبائل نمبر",phonePlaceholder:"مثلاً 0300 1234567",confirmOrder:"آرڈر کی تصدیق کریں",sending:"بھیجا جا رہا ہے…",back:"واپس",
 itemName:"آئٹم کا نام",price:"قیمت",qty:"تعداد",amount:"رقم",subtotal:"ذیلی کل",tax:"ٹیکس",discount:"رعایت",total:"کل رقم",finalBill:"حتمی بل کیشیئر دے گا۔",
 thanks:"شکریہ",waiterWillConfirm:"ہمارا ویٹر صرف 2 منٹ میں آپ کے آرڈر کی تصدیق کرے گا۔",smsUpdates:"آپ کو ایس ایم ایس کے ذریعے بھی اطلاع ملے گی۔",
 orderStatus:"آرڈر کی صورتحال",orderNumber:"آرڈر نمبر",orderMore:"کچھ اور آرڈر کریں",paid:"ادا شدہ",
 stage_WAITING:"ویٹر کی تصدیق کا انتظار ہے",stage_CONFIRMED:"تصدیق ہو گئی — کچن بھیج دیا گیا",stage_PREPARING:"تیار ہو رہا ہے",stage_READY:"پیش کرنے کے لیے تیار",stage_SERVED:"پیش کر دیا گیا — مزے سے کھائیں!",stage_COMPLETED:"مکمل — تشریف لانے کا شکریہ!",stage_CANCELLED:"یہ آرڈر منسوخ کر دیا گیا۔ براہ کرم ہمارے عملے سے رابطہ کریں۔",
 error_INVALID:"یہ کیو آر کوڈ درست نہیں۔ براہ کرم اپنی ٹیبل پر لگا کوڈ دوبارہ اسکین کریں۔",error_CLOSED:"کیو آر آرڈر ابھی دستیاب نہیں۔ براہ کرم ہمارے ویٹر سے کہیں۔",error_COUNTER_CLOSED:"کاؤنٹر بند ہونے کی وجہ سے ابھی ٹیبل سے آرڈر نہیں لیے جا رہے۔",
 error_BUSY:"ایک ساتھ بہت زیادہ آرڈر آ گئے۔ چند منٹ انتظار کر کے دوبارہ کوشش کریں۔",error_LIMIT:"آپ کے آرڈر پہلے سے انتظار میں ہیں۔ ہمارا ویٹر جلد آپ کے پاس آئے گا۔",
 error_NAME:"براہ کرم اپنا نام لکھیں۔",error_PHONE:"براہ کرم درست موبائل نمبر لکھیں، مثلاً 0300 1234567۔",error_EMPTY:"آپ کا کارٹ خالی ہے۔",
 error_UNAVAILABLE:"ایک آئٹم اب دستیاب نہیں۔ اسے ہٹا کر دوبارہ کوشش کریں۔",error_ERROR:"آرڈر نہیں بھیجا جا سکا۔ انٹرنیٹ چیک کر کے دوبارہ کوشش کریں۔",
 verifyTitle:"اپنے موبائل نمبر کی تصدیق کریں",verifySent:"ہم نے 4 ہندسوں کا کوڈ ایس ایم ایس کے ذریعے بھیجا ہے",code:"کوڈ",verifyButton:"تصدیق کریں اور آرڈر بھیجیں",verifying:"جانچ ہو رہی ہے…",
 resend:"کوڈ دوبارہ بھیجیں",resendIn:"دوبارہ بھیجیں",seconds:"سیکنڈ",changeNumber:"نمبر تبدیل کریں",verifyOnce:"اس فون پر یہ صرف ایک بار کرنا ہوگا۔",
 error_CODE:"یہ کوڈ درست نہیں۔ ایس ایم ایس دیکھ کر دوبارہ کوشش کریں۔",error_EXPIRED:"اس کوڈ کی مدت ختم ہو گئی۔ براہ کرم نیا کوڈ منگوائیں۔",
 language:"زبان",poweredBy:"Software developed by: Cubedevsys.com",
};

const sd:QrText={
 welcome:"ڀلي ڪري آيا",table:"ٽيبل",intro:"پنهنجو کاڌو چونڊيو، ڪارٽ ۾ وجهو ۽ آرڊر موڪليو. اسان جو ويٽر توهان سان آرڊر جي تصديق ڪندو.",
 search:"مينيو ۾ ڳوليو",all:"سڀ",Deals:"ڊيلز",Menu:"مينيو",noItems:"ڪا شيءِ نه ملي",
 add:"شامل ڪريو",inCart:"ڪارٽ ۾",increase:"هڪ وڌيڪ",decrease:"هڪ گهٽ",chooseWeight:"وزن چونڊيو",perKg:"في ڪلو",
 viewCart:"آرڊر ڏسو",items:"شيون",item:"شيءِ",yourOrder:"توهان جو آرڊر",emptyCart:"توهان جو ڪارٽ خالي آهي. مينيو مان ڪجهه مزيدار شامل ڪريو.",
 note:"ڪچن لاءِ هدايت (اختياري)",notePlaceholder:"مثال طور گهٽ مرچ",remove:"هٽايو",backToMenu:"مينيو ڏانهن واپس",continue:"اڳتي هلو",
 yourDetails:"توهان جي معلومات",detailsIntro:"توهان جو موبائل نمبر صرف هن آرڊر جي اطلاع موڪلڻ لاءِ استعمال ٿيندو.",name:"توهان جو نالو",namePlaceholder:"مثال طور علي خان",
 phone:"موبائل نمبر",phonePlaceholder:"مثال طور 0300 1234567",confirmOrder:"آرڊر جي تصديق ڪريو",sending:"موڪلي رهيا آهيون…",back:"واپس",
 itemName:"شيءِ جو نالو",price:"قيمت",qty:"تعداد",amount:"رقم",subtotal:"ذيلي جوڙ",tax:"ٽيڪس",discount:"رعايت",total:"ڪل رقم",finalBill:"آخري بل ڪيشيئر ڏيندو.",
 thanks:"مهرباني",waiterWillConfirm:"اسان جو ويٽر رڳو 2 منٽن ۾ توهان جي آرڊر جي تصديق ڪندو.",smsUpdates:"توهان کي ايس ايم ايس ذريعي به اطلاع ملندي.",
 orderStatus:"آرڊر جي صورتحال",orderNumber:"آرڊر نمبر",orderMore:"ٻيو ڪجهه آرڊر ڪريو",paid:"ادا ٿيل",
 stage_WAITING:"ويٽر جي تصديق جو انتظار آهي",stage_CONFIRMED:"تصديق ٿي وئي — ڪچن ڏانهن موڪليو ويو",stage_PREPARING:"تيار ٿي رهيو آهي",stage_READY:"پيش ڪرڻ لاءِ تيار",stage_SERVED:"پيش ڪيو ويو — مزي سان کائو!",stage_COMPLETED:"مڪمل — اچڻ جي مهرباني!",stage_CANCELLED:"هي آرڊر رد ڪيو ويو. مهرباني ڪري اسان جي عملي کان پڇو.",
 error_INVALID:"هي ڪيو آر ڪوڊ صحيح ناهي. مهرباني ڪري پنهنجي ٽيبل وارو ڪوڊ ٻيهر اسڪين ڪريو.",error_CLOSED:"ڪيو آر آرڊر هن وقت موجود ناهي. مهرباني ڪري ويٽر کي چئو.",error_COUNTER_CLOSED:"ڪائونٽر بند هجڻ ڪري هن وقت ٽيبل تان آرڊر نه ورتا پيا وڃن.",
 error_BUSY:"هڪ ئي وقت گهڻا آرڊر آيا. ڪجهه منٽ ترسي ٻيهر ڪوشش ڪريو.",error_LIMIT:"توهان جا آرڊر اڳ ۾ ئي انتظار ۾ آهن. اسان جو ويٽر جلد توهان وٽ ايندو.",
 error_NAME:"مهرباني ڪري پنهنجو نالو لکو.",error_PHONE:"مهرباني ڪري صحيح موبائل نمبر لکو، مثال طور 0300 1234567.",error_EMPTY:"توهان جو ڪارٽ خالي آهي.",
 error_UNAVAILABLE:"هڪ شيءِ هاڻي موجود ناهي. ان کي هٽائي ٻيهر ڪوشش ڪريو.",error_ERROR:"آرڊر موڪلي نه سگهياسين. انٽرنيٽ چيڪ ڪري ٻيهر ڪوشش ڪريو.",
 verifyTitle:"پنهنجي موبائل نمبر جي تصديق ڪريو",verifySent:"اسان 4 انگن وارو ڪوڊ ايس ايم ايس ذريعي موڪليو آهي",code:"ڪوڊ",verifyButton:"تصديق ڪريو ۽ آرڊر موڪليو",verifying:"جانچ ٿي رهي آهي…",
 resend:"ڪوڊ ٻيهر موڪليو",resendIn:"ٻيهر موڪليو",seconds:"سيڪنڊ",changeNumber:"نمبر بدلايو",verifyOnce:"هن فون تي اهو صرف هڪ ڀيرو ڪرڻو پوندو.",
 error_CODE:"هي ڪوڊ صحيح ناهي. ايس ايم ايس ڏسي ٻيهر ڪوشش ڪريو.",error_EXPIRED:"هن ڪوڊ جي مدت ختم ٿي وئي. مهرباني ڪري نئون ڪوڊ گهرايو.",
 language:"ٻولي",poweredBy:"Software developed by: Cubedevsys.com",
};

export const QR_TEXT:Record<QrLanguage,QrText>={en,ur,sd};
