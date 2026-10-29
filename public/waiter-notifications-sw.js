self.addEventListener("push", event => {
 const payload=event.data?.json()??{};
 event.waitUntil(self.registration.showNotification(payload.title??"Restaurant POS",{body:payload.body??"An order has an update. Open your waiter screen to view it.",icon:"/waiter-icon.svg",data:{url:"/waiter"}}));
});
self.addEventListener("notificationclick", event => {
 event.notification.close();
 event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(async clients => {
  const client=clients.find(client=>new URL(client.url).pathname.startsWith("/waiter"));
  if(client){await client.navigate("/waiter/my-orders");return client.focus()}
  return self.clients.openWindow("/waiter/my-orders");
 }));
});
