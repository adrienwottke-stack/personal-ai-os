"""Daily encrypted state snapshots, on the same VPS; no container restart needed."""
from pathlib import Path
import subprocess
script=Path('/srv/personal-ai-os-live/integrations/hermes/backup.py')
if not script.is_file():raise RuntimeError('Assistant backup source is missing')
Path('/etc/systemd/system/personal-assistant-backup.service').write_text('''[Unit]
Description=Encrypted private Hermes state snapshot
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /srv/personal-ai-os-live/integrations/hermes/backup.py
UMask=0077
Nice=10
MemoryMax=256M
''')
Path('/etc/systemd/system/personal-assistant-backup.timer').write_text('''[Unit]
Description=Daily encrypted private Hermes snapshot
[Timer]
OnCalendar=*-*-* 04:15:00 UTC
RandomizedDelaySec=300
Persistent=true
[Install]
WantedBy=timers.target
''')
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemctl','enable','--now','personal-assistant-backup.timer'],check=True)
print('Daily encrypted Hermes snapshots enabled.')
