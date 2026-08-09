install:
	bundle install

serve: install
	bundle exec jekyll serve

resume:
	python3 scripts/generate_resume_pdf.py
