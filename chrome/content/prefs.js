var pdmtsPrefs =
{
	logLevelChanged: function()
	{
		let logLevelPref = document.getElementById("pdmts.logLevel");
		let logPathsPref = document.getElementById("pdmts.logPaths");
		logPathsPref.disabled = (logLevelPref.value == 3);
	},

	logLevelSync: function()
	{
		this.logLevelChanged();
		return undefined;
	}
}

