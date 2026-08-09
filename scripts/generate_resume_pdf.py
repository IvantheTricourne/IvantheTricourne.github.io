#!/usr/bin/env python3
"""Render _data/resume.yml -> resume.pdf, so the resume can be edited as
plain data instead of round-tripping through Google Docs."""
import pathlib

import yaml
from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    data = yaml.safe_load((ROOT / "_data" / "resume.yml").read_text())

    env = Environment(loader=FileSystemLoader(str(ROOT / "scripts")))
    template = env.get_template("resume_template.html.j2")
    html = template.render(r=data)

    out_html = ROOT / "scripts" / "_resume_rendered.html"
    out_html.write_text(html)

    HTML(filename=str(out_html), base_url=str(ROOT)).write_pdf(str(ROOT / "resume.pdf"))
    out_html.unlink()

    print(f"wrote {ROOT / 'resume.pdf'}")


if __name__ == "__main__":
    main()
