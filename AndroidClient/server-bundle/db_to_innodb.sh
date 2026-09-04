#!/bin/bash
# Convert rAthena hot tables MyISAM -> InnoDB so the mobile map server's
# login SELECTs stop blocking behind the live server's table-level write locks
# (the 3-minute char-select -> in-world stall).
#
#   bash db_to_innodb.sh
#
# IMPORTANT: each ALTER locks that table while it rebuilds it. On a populated
# live server, run this in a MAINTENANCE WINDOW (players off / low activity).
# The size list it prints first tells you how long to expect.
set -e
DB="${DB:-ragnarok_main}"

HOT="char inventory cart_inventory storage guild_storage skill skillcooldown \
quest quest_objectives mail mail_attachments \
char_reg_num char_reg_str acc_reg_num acc_reg_str \
global_acc_reg_num global_acc_reg_str \
party guild guild_member guild_position guild_skill guild_alliance \
guild_expulsion guild_castle hotkey memo friends pet homunculus \
skill_homunculus sc_data bonus_script achievement"

echo "== MyISAM tables in $DB (MB - bigger = longer lock) =="
sudo mysql "$DB" -e "SELECT table_name, ROUND((data_length+index_length)/1048576,1) AS mb \
FROM information_schema.tables WHERE table_schema='$DB' AND engine='MyISAM' ORDER BY mb DESC;"

echo
read -r -p "Back up '$DB' then convert the hot tables to InnoDB? (type yes) " ok
[ "$ok" = "yes" ] || { echo "aborted."; exit 1; }

TS=$(date +%Y%m%d-%H%M%S)
BK="$HOME/${DB}.${TS}.sql.gz"
echo "== backup -> $BK =="
sudo mysqldump --routines --triggers --events "$DB" | gzip > "$BK"
ls -lh "$BK"

echo "== converting =="
for t in $HOT; do
  eng=$(sudo mysql "$DB" -N -e "SELECT engine FROM information_schema.tables \
WHERE table_schema='$DB' AND table_name='$t';" 2>/dev/null || true)
  if [ "$eng" = "MyISAM" ]; then
    printf '  %-24s ' "$t"
    if sudo mysql "$DB" -e "ALTER TABLE \`$t\` ENGINE=InnoDB;" 2>/tmp/alt.err; then
      echo "-> InnoDB"
    else
      echo "-> FAILED: $(cat /tmp/alt.err)"
    fi
  fi
done

echo
echo "== tables still MyISAM in $DB =="
sudo mysql "$DB" -e "SELECT table_name FROM information_schema.tables \
WHERE table_schema='$DB' AND engine='MyISAM';"

echo
echo "Done. Now restart both rAthena servers:"
echo "  sudo systemctl restart fatemmo-mobile-login fatemmo-mobile-char fatemmo-mobile-map"
echo "  (and your LIVE login/char/map services)"
echo
echo "Restore if needed:  gunzip < $BK | sudo mysql $DB"
