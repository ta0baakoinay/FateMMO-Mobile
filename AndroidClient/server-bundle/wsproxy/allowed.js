// Drop-in replacement for roBrowserLegacy-wsProxy/allowed.js
// (only used if you run wsProxy WITHOUT the -a flag; the docker-compose here
//  passes -a, which overrides this file.)
//
// These are the ip:port targets roBrowser will ask wsProxy to dial. With
// forceUseAddress:true + address=167.104.101.102 the host is always the proxy IP;
// the ports are what the mobile rAthena instance advertises.
module.exports = [
	"167.104.101.102:6900", // login  (mobile rAthena instance, via proxy)
	"167.104.101.102:6121", // char
	"167.104.101.102:5121"  // map
];
