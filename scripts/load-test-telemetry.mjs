// Loaded only by the isolated production benchmark process.
if (process.send) {
  const report = () => {
    const cpu = process.cpuUsage();
    process.send?.({ type: "load-test-metrics", rssMB: process.memoryUsage().rss / 1048576, cpuMS: (cpu.user + cpu.system) / 1000 });
  };
  report();
  const timer = setInterval(report, 1000);
  timer.unref();
  process.on("disconnect", () => clearInterval(timer));
}
