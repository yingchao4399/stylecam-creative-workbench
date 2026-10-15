# EasyInput 基础版硬件联调记录

## 环境

- Windows 主机已枚举 `EasyInput AI` USB HID：`VID_303A&PID_1006`。
- 工作台使用标准 Windows 键盘事件，不改固件、不烧录设备。
- 监听脚本：`scripts/capture-easyinput-keys.ps1`。

## 已捕获

一次 30 秒监听中捕获到：

| 原始键值 | 推定动作 | 证据 |
| --- | --- | --- |
| `VK=0x31` / `1` | S1 或数字 1 | Windows `GetAsyncKeyState` 监听输出 |
| `VK=0x0D` / `Enter` | 旋钮短按或 Enter | Windows `GetAsyncKeyState` 监听输出 |

这两类事件与工作台基础映射一致：数字 `1` 进入强度调节，`Enter` 确认强度或发起生成。

## 诊断方法校正

旧版监听脚本使用 `GetAsyncKeyState`，只能看到当前 Windows 桌面上的虚拟键状态，无法证明事件来自 EasyInput。现已改为 Windows Raw Input，并按设备路径过滤 `VID_303A&PID_1006`，同时监听键盘、鼠标和厂商 HID 集合（旋钮若以滚轮或自定义 HID 报告上报也会显示）。运行 2 秒、没有操作设备时结果为 `Capture finished: 0 device events.`，因此当前脚本不会把普通键盘输入计入 EasyInput 证据。

## 尚未捕获

第二次 45 秒监听没有收到新的键值，因此 S2～S8、旋钮左右方向仍未完成实测。不能根据设备枚举或课程默认配置替代这些证据。

## 补测方法

在工作台保持前台，执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\capture-easyinput-keys.ps1 -Seconds 45
```

监听期间依次按 S1～S8、旋钮左右和短按。记录输出后，再把每个实际键值填入 StyleCam 的“设备输入”映射；如果只出现 `1`/`Enter`，先检查 EasyInput 配置是否只同步了部分按键，再检查 USB 数据线和配置程序状态。

Raw Input 输出中的 `keyboard VK`、`scan`、`mouse wheel`、`hid data` 才是本次联调记录的有效来源；仍需实体操作后才能判定 S1～S8 与编码器方向的完整映射。

## 最新实测

2026-10-14 运行设备专用 Raw Input 监听 60 秒，结果为 `Capture finished: 0 device events.`。本轮没有收到实体操作，因此没有新增按键映射证据；不能把“设备在线”或“监听脚本正常”写成“硬件联调完成”。

## 2026-10-15 设备层调试

新增设备枚举命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\capture-easyinput-keys.ps1 -ListDevices
```

当前枚举结果确认三个 Raw Input 集合均可见：

```text
type=2  ...VID_303A&PID_1006&Col03...
type=0  ...VID_303A&PID_1006&Col02...
type=1  ...VID_303A&PID_1006&Col01...
```

因此 Windows 设备路径过滤和 Raw Input 注册已经通过；仍需在监听窗口存活期间按下实体按键，才能取得具体报告。
