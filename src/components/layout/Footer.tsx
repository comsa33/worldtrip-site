import { Link } from 'react-router-dom';
import { Mail, ExternalLink, Globe } from 'lucide-react';
import './Footer.css';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__content">
          {/* Brand */}
          <div className="footer__brand">
            <Link to="/" className="footer__logo">
              <div className="footer__logo-mark">
                <Globe size={18} />
              </div>
              <span className="footer__logo-text">World Trip</span>
            </Link>
            <p className="footer__tagline">
              345 days of wandering around the world
            </p>
          </div>
          
          {/* Links */}
          <div className="footer__links">
            <div className="footer__links-group">
              <span className="footer__links-title">Explore</span>
              <Link to="/journey">Journey</Link>
              <Link to="/countries">Countries</Link>
              <Link to="/about">About</Link>
            </div>
            <div className="footer__links-group">
              <span className="footer__links-title">Contact</span>
              <a href="mailto:comsa333@gmail.com">
                <Mail size={14} />
                <span>Email</span>
              </a>
              <a href="https://po24lio.com" target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} />
                <span>Portfolio</span>
              </a>
            </div>
          </div>
        </div>
        
        {/* Bottom */}
        <div className="footer__bottom">
          <p className="footer__copyright">
            © 2025 이루오. All rights reserved.
          </p>
          <p className="footer__date">
            2016.07 — 2017.06
          </p>
        </div>
      </div>
    </footer>
  );
}
