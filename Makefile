VERSION := $(shell grep version install.manifest | sed 's/version=//')

all: clean rdf zip

clean:
	rm -f install.rdf
	rm -f *.xpi

rdf: install.manifest
	./genManifest.py

zip:
	zip -r status4evar-$(VERSION)-fx.xpi \
		chrome \
		defaults \
		modules \
		chrome.manifest \
		install.rdf \
		components/pdmts.js

