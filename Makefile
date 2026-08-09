install:
	sudo gem install jekyll-sitemap jekyll-feed jekyll-paginate

serve: install
	jekyll serve

resume:
	python3 scripts/generate_resume_pdf.py
