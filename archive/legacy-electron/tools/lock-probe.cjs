// 单例锁探测：能拿到锁即代表旧实例已完全退出（锁随进程退出自动释放）。
// 探测进程随即退出，绝不触碰真实实例；退出码 0=锁空闲，3=旧实例仍持有。
const {app}=require("electron");
const [userData,name]=process.argv.slice(2);
app.setPath("userData",userData);app.setName(name);
const free=app.requestSingleInstanceLock();
process.stdout.write(free?"LOCK_FREE\n":"LOCK_BUSY\n");
setTimeout(()=>app.exit(free?0:3),50);
