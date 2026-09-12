Milk Collection scale agent for the reception computer

Recommended setup:
1. Install Node.js on this computer if it is not already installed.
2. Put this folder somewhere stable, for example C:\MilkScaleAgent.
3. Check the .env file. For the current reception computer it should say:
   WEIGHBRIDGE_SERIAL_PORT=COM5
   WEIGHBRIDGE_BAUD_RATE=9600
4. Double-click InstallScaleAgentUserStartup.cmd.
5. Double-click CheckScaleAgent.cmd and confirm that /health and /current-weight return data.

After install, the scale agent runs hidden whenever this Windows user logs in.
The user does not need to keep a black command window open.

Alternative admin setup:
- InstallScaleAgentStartupTask.cmd installs a Windows Task Scheduler task.
- Use this only when the reception computer allows the task to run reliably.

Useful files:
- CheckScaleAgent.cmd: shows task status and reads the current scale weight.
- StopScaleAgent.cmd: stops the hidden agent.
- InstallScaleAgentUserStartup.cmd: installs or refreshes the hidden per-user startup shortcut and starts it.
- UninstallScaleAgentUserStartup.cmd: removes the hidden per-user startup shortcut.
- InstallScaleAgentStartupTask.cmd: installs or refreshes the hidden scheduled task and starts it.
- UninstallScaleAgentStartupTask.cmd: removes the hidden scheduled task.
- StartScaleAgentHidden.cmd: starts the hidden agent once without installing startup.
- StartScaleAgentVisible.cmd: starts the agent in a visible window for debugging only.
- logs\scale-agent.log: background agent log file.

If the COM port changes, edit .env, then run InstallScaleAgentUserStartup.cmd again.
