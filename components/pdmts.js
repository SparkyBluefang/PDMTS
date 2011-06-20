/* ***** BEGIN LICENSE BLOCK *****
 *   Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 * 
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Preserve Download Modification Timestamp.
 *
 * The Initial Developer of the Original Code is 
 * Matthew Turnbull <sparky@bluefang-logic.com>.
 *
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 * 
 * ***** END LICENSE BLOCK ***** */

// Component constants
const CC = Components.classes;
const CI = Components.interfaces;
const CU = Components.utils;

// Logging constants
const LOG_DEBUG		= 3;
const LOG_INFO		= 2;
const LOG_WARNING	= 1;
const LOG_ERROR		= 0;

CU.import("resource://gre/modules/XPCOMUtils.jsm");

function PDMTS()
{
	try
	{
		CU.import("resource://gre/modules/Services.jsm");
	}
	catch(e)
	{
		// Gecko 1.9 compat
		CU.import("resource://pdmts/ServicesCompat.jsm");
	}
}

PDMTS.prototype =
{
	classID:		Components.ID("{7831d108-609c-4d69-8d19-cb885e343812}"),
	QueryInterface:		XPCOMUtils.generateQI([
					CI.nsISupportsWeakReference,
					CI.nsIDownloadProgressListener,
					CI.nsIObserver
				]),

	prefs:			null,
	strings:		null,
	dlManager:		null,
	isListening:		false,
	logSanitize:		false,
	logPaths:		false,
	logLevel:		LOG_ERROR,
	dlTS:			{},

	// Gecko 1.9 compat
	classDescription:	"PDMTS",
	contractID:		"@caligonstudios.com/pdmts;1",
	_xpcom_categories:	[{ category: "profile-after-change" }],

	startup: function()
	{
		this.prefs = Services.prefs.getBranch("pdmts.").QueryInterface(CI.nsIPrefBranch2);
		this.strings = Services.strings.createBundle("chrome://pdmts/locale/console.properties");
		this.dlManager = CC["@mozilla.org/download-manager;1"].getService(CI.nsIDownloadManager);

		Services.obs.addObserver(this, "quit-application", true);
		Services.obs.addObserver(this, "private-browsing", true);
		this.prefs.addObserver("enabled", this, true);
		this.prefs.addObserver("logLevel", this, true);
		this.prefs.addObserver("logPaths", this, true);

		this.updateLogLevel();
		this.logPaths = this.prefs.getBoolPref("logPaths");
		this.log(LOG_INFO, "log.paths", [this.logPaths]);
		try
		{
			this.logSanitize = Components.classes["@mozilla.org/privatebrowsing;1"]
						.getService(CI.nsIPrivateBrowsingService).privateBrowsingEnabled;
			this.log(LOG_INFO, "log.clean", [this.logSanitize]);
		} catch(e) { /* Private browsing not supported */ }

		this.updateEnabled();

		this.log(LOG_INFO, "startup");
	},

	shutdown: function()
	{
		Services.obs.removeObserver(this, "quit-application");
		Services.obs.removeObserver(this, "private-browsing");
		this.prefs.removeObserver("enabled", this);
		this.prefs.removeObserver("logLevel", this);
		this.prefs.removeObserver("logPaths", this);
		this.stopListening();

		this.log(LOG_INFO, "shutdown");

		this.prefs = null;
		this.strings = null;
		this.dlManager = null;
	},

	// nsIObserver
	observe: function(subject, topic, data)
	{
		switch (topic)
		{
			case "profile-after-change":
				this.startup();
				break;
			case "quit-application":
				this.shutdown();
				break;
			case "nsPref:changed":
				switch(data)
				{
					case "enabled":
						this.updateEnabled();
						break;
					case "logLevel":
						this.updateLogLevel();
						break;
					case "logPaths":
						this.logPaths = this.prefs.getBoolPref("logPaths");
						this.log(LOG_INFO, "log.paths", [this.logPaths]);
						break;
				}
				break;
			case "private-browsing":
				switch(data)
				{
					case "enter":
						this.log(LOG_INFO, "log.clean", [true]);
						this.logSanitize = true;
						break;
					case "exit":
						this.logSanitize = false;
						this.log(LOG_INFO, "log.clean", [false]);
						break;
				}
				break;
		}
	},

	// nsIDownloadProgressListener
	onSecurityChange: function(prog, req, state, dl) {},
	onProgressChange: function(prog, req, prog, progMax, tProg, tProgMax, dl) {},
	onStateChange: function(prog, req, flags, status, dl)
	{
		// We only want to look at the URI we know about
		// Basically, ignore "Web page, complete" downloads
		// Also handle case where req is null
		if(!(req instanceof CI.nsIChannel)
		|| !(dl.source.equals(req.URI) || dl.source.equals(req.originalURI)))
		{
			return;
		}

		this.log(LOG_DEBUG, "net.stat", [flags.toString(16), status], req.URI.spec);

		// Only rely on STATE_START and STATE_STOP... and STATE_STOP might come
		// after DOWNLOAD_FINISHED. So wait for STATE_START.
		if(!(flags & CI.nsIWebProgressListener.STATE_START))
		{
			return;
		}

		// Get the download target
		let f = dl.targetFile;
		if(!f)
		{
			this.log(LOG_ERROR, "dl.notarget");
			return;
		}

		// Get the modification timestamp from the server response
		let d;
		if(req instanceof CI.nsIHttpChannel)
		{
			try
			{
				d = Date.parse(req.getResponseHeader("Last-Modified"));
			} catch(e) { /* Ignore missing header errors */ }
			this.log(LOG_INFO, "net.http", null, f.path);
		}
		else if(req instanceof CI.nsIFileChannel)
		{
			d = req.file.lastModifiedTime;
			this.log(LOG_INFO, "net.file", null, f.path);
		}
		else if(req instanceof CI.nsIFTPChannel)
		{
			d = req.lastModifiedTime;
			if(d)
			{	// This is silly.
				d /= 1000;
			}
			this.log(LOG_INFO, "net.ftp", null, f.path);
		}

		// If we have a valid timestamp, save it
		if(d && d > 0)
		{
			this.dlTS[dl.id] = d;
		}
	},
	onDownloadStateChange: function(state, dl)
	{
		// Get the download target
		let f = dl.targetFile;
		if(!f)
		{
			this.log(LOG_ERROR, "dl.notarget");
			return;
		}

		this.log(LOG_DEBUG, "dl.stat", [dl.state], f.path);

		switch(dl.state)
		{
			case CI.nsIDownloadManager.DOWNLOAD_FINISHED:
				// The download finished - continue
				break;
			case CI.nsIDownloadManager.DOWNLOAD_CANCELED:
			case CI.nsIDownloadManager.DOWNLOAD_FAILED:
			case CI.nsIDownloadManager.DOWNLOAD_BLOCKED_PARENTAL:
			case CI.nsIDownloadManager.DOWNLOAD_BLOCKED_POLICY:
			case CI.nsIDownloadManager.DOWNLOAD_DIRTY:
				// The download failed - cleanup
				this.log(LOG_DEBUG, "dl.failed", null, f.path);
				delete this.dlTS[dlid];
			default:
				// The download is active - do nothing
				return;
		}

		this.log(LOG_DEBUG, "dl.finished", null, f.path);

		// Ensure the downloaded target exists
		if(!f.exists())
		{
			this.log(LOG_ERROR, "dl.nofile", null, f.path);
			return;
		}

		// Update the modification timestamp
		let d = this.dlTS[dl.id];
		delete this.dlTS[dl.id];
		if(d)
		{
			f.lastModifiedTime = d;
			d = new Date(d);
			this.log(LOG_INFO, "dl.updated", [d.toUTCString()], f.path);
		}
		else
		{
			this.log(LOG_INFO, "dl.unavailable", null, f.path);
		}
	},

	// If we're not listening for downloads, begin listening.
	startListening: function()
	{
		if(!this.isListening)
		{
			this.dlManager.addListener(this);
			this.isListening = true;
		}
		this.log(LOG_INFO, "enabled");
	},

	// If we're listening for downloads, stop listening.
	stopListening: function()
	{
		if(this.isListening)
		{
			this.dlManager.removeListener(this);
			this.isListening = false;
		}
		this.log(LOG_INFO, "disabled");
	},

	// Check the 'enabled' preference and act accordingly.
	updateEnabled: function()
	{
		let state = this.prefs.getBoolPref("enabled");

		if(state)
		{
			this.startListening();
		}
		else
		{
			this.stopListening();
		}
	},

	// Set the logging verbosity level
	updateLogLevel: function()
	{
		let lvl = this.prefs.getIntPref("logLevel");

		if(lvl < LOG_ERROR)
		{
			lvl = LOG_ERROR;
		}
		else if(lvl > LOG_DEBUG)
		{
			lvl = LOG_DEBUG;
		}

		this.logLevel = lvl;
		this.log(LOG_INFO, "log.level", [this.logLevel]);
	},

	// Log a message to the error console
	log: function(lvl, msgID, args, note)
	{
		let eLogLevel = (this.logSanitize) ? LOG_WARNING : this.logLevel;
		if(lvl <= eLogLevel)
		{
			let msg = "PDMTS: ";

			if(args)
			{
				msg += this.strings.formatStringFromName(msgID, args, args.length)
			}
			else
			{
				msg += this.strings.GetStringFromName(msgID)
			}

			if(note && !this.logSanitize && (this.logPaths || eLogLevel == LOG_DEBUG))
			{
				msg += "\n\t" + note
			}

			dump(msg + "\n");
			switch(lvl)
			{
				case LOG_DEBUG:
				case LOG_INFO:
					Services.console.logStringMessage(msg);
					break;
				case LOG_WARNING:
				case LOG_ERROR:
					let scriptError = CC["@mozilla.org/scripterror;1"].createInstance(CI.nsIScriptError);
					let scriptFlags = lvl == LOG_ERROR ? scriptError.errorFlag : scriptError.warningFlag;
					scriptError.init(msg, null, null, null, null, scriptFlags, null);
					Services.console.logMessage(scriptError);
					break;
			}
		}
	}
}

// Export XPCOM symbols
if (XPCOMUtils.generateNSGetFactory)
	const NSGetFactory = XPCOMUtils.generateNSGetFactory([PDMTS]);
else
	const NSGetModule = XPCOMUtils.generateNSGetModule([PDMTS]);

