#!/usr/bin/env bash
# Preview xcowsay notifications — no running service needed.
#
# Usage:
#   ./tests/test-notification.sh              # show all samples
#   ./tests/test-notification.sh calendar      # google calendar sample
#   ./tests/test-notification.sh hungerhub     # hungerhub sample
#   ./tests/test-notification.sh socket        # unix socket sample
#   ./tests/test-notification.sh "custom msg"  # custom message
set -euo pipefail

if ! command -v xcowsay &>/dev/null; then
  echo "xcowsay not found. Install it with: sudo apt install xcowsay"
  exit 1
fi

TIME=5

show_calendar() {
  xcowsay --time="$TIME" "In 5 min: Weekly standup
10:30 AM"
}

show_hungerhub() {
  xcowsay --time="$TIME" "Your Sushi Palace order is on its way
Items: Salmon Roll, Miso Soup
Bag #42 | ETA: 12:30 PM"
}

show_socket() {
  xcowsay --time="$TIME" "moo-notify is working!"
}

case "${1:-all}" in
  calendar)  show_calendar ;;
  hungerhub) show_hungerhub ;;
  socket)    show_socket ;;
  all)
    show_calendar
    show_hungerhub
    show_socket
    ;;
  *)
    xcowsay --time="$TIME" "$1"
    ;;
esac
